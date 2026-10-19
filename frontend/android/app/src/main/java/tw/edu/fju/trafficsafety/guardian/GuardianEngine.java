package tw.edu.fju.trafficsafety.guardian;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * 守護模式的判斷邏輯（純 Java，不依賴 Android，方便單元測試）。
 *
 * 規則：
 * 1. 依交通方式決定提醒距離：步行 60 m、騎車 120 m、開車 220 m；「自動」依速度判斷。
 * 2. 搭乘大眾運輸（transit）時不提醒（乘客不需要路口提醒）。
 * 3. 只在「正在接近」路口時提醒：距離比上一次定位更近，或剛進入範圍。
 * 4. 同一個路口 10 分鐘內不重複提醒。
 */
public class GuardianEngine {

    public static class Hotspot {
        public final int id;
        public final String name;
        public final double lat, lon;
        public final String level;
        public final int accidents;

        public Hotspot(int id, String name, double lat, double lon, String level, int accidents) {
            this.id = id; this.name = name; this.lat = lat; this.lon = lon; this.level = level; this.accidents = accidents;
        }
    }

    public static class Alert {
        public final Hotspot hotspot;
        public final double distance;
        public final String mode;

        Alert(Hotspot h, double d, String mode) { this.hotspot = h; this.distance = d; this.mode = mode; }
    }

    public static final long COOLDOWN_MS = 10 * 60 * 1000L;

    private final List<Hotspot> hotspots = new ArrayList<>();
    private final Map<Integer, Double> lastDistance = new HashMap<>();
    private final Map<Integer, Long> lastAlertAt = new HashMap<>();
    private String userMode = "auto"; // auto / foot / bike / car / transit

    public synchronized void setHotspots(List<Hotspot> list) {
        hotspots.clear();
        hotspots.addAll(list);
        lastDistance.keySet().retainAll(idsOf(list));
    }

    public synchronized int size() { return hotspots.size(); }

    public synchronized void setUserMode(String m) { userMode = m == null ? "auto" : m; }

    public synchronized String getUserMode() { return userMode; }

    /** 依使用者設定與速度（m/s，未知時 <0）決定實際交通方式。 */
    public String effectiveMode(double speed) {
        if (!"auto".equals(userMode)) return userMode;
        if (speed < 0) return "foot";
        if (speed < 2.5) return "foot";     // 約 9 km/h 以下
        if (speed < 8.0) return "bike";     // 約 29 km/h 以下
        return "car";
    }

    public static double alertRadius(String mode) {
        switch (mode) {
            case "car": return 220;
            case "bike": return 120;
            default: return 60;
        }
    }

    /** 每次定位呼叫一次；回傳要提醒的路口（沒有則回傳 null）。 */
    public synchronized Alert onLocation(double lat, double lon, double speed, long now) {
        String mode = effectiveMode(speed);
        if ("transit".equals(mode)) return null;
        double radius = alertRadius(mode);
        Alert best = null;
        for (Hotspot h : hotspots) {
            double d = distance(lat, lon, h.lat, h.lon);
            Double prev = lastDistance.put(h.id, d);
            if (d > radius) continue;
            boolean approaching = prev == null || prev > radius || d < prev - 0.5;
            Long last = lastAlertAt.get(h.id);
            boolean cooled = last == null || now - last > COOLDOWN_MS;
            if (approaching && cooled && (best == null || d < best.distance)) best = new Alert(h, d, mode);
        }
        if (best != null) lastAlertAt.put(best.hotspot.id, now);
        return best;
    }

    /** 最近的危險路口（狀態列顯示用）。 */
    public synchronized Object[] nearest(double lat, double lon) {
        Hotspot best = null;
        double bd = Double.MAX_VALUE;
        for (Hotspot h : hotspots) {
            double d = distance(lat, lon, h.lat, h.lon);
            if (d < bd) { bd = d; best = h; }
        }
        return best == null ? null : new Object[]{best, bd};
    }

    public static double distance(double lat1, double lon1, double lat2, double lon2) {
        double r = 6371000, p1 = Math.toRadians(lat1), p2 = Math.toRadians(lat2);
        double dp = p2 - p1, dl = Math.toRadians(lon2 - lon1);
        double a = Math.sin(dp / 2) * Math.sin(dp / 2) + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) * Math.sin(dl / 2);
        return 2 * r * Math.asin(Math.sqrt(a));
    }

    private static java.util.Set<Integer> idsOf(List<Hotspot> list) {
        java.util.Set<Integer> s = new java.util.HashSet<>();
        for (Hotspot h : list) s.add(h.id);
        return s;
    }
}
