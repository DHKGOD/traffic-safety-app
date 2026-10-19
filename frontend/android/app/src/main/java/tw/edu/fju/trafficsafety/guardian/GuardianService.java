package tw.edu.fju.trafficsafety.guardian;

import android.annotation.SuppressLint;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ServiceInfo;
import android.location.Location;
import android.media.AudioAttributes;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.speech.tts.TextToSpeech;
import android.util.Log;

import androidx.annotation.NonNull;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;

import com.google.android.gms.location.FusedLocationProviderClient;
import com.google.android.gms.location.LocationCallback;
import com.google.android.gms.location.LocationRequest;
import com.google.android.gms.location.LocationResult;
import com.google.android.gms.location.LocationServices;
import com.google.android.gms.location.Priority;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import tw.edu.fju.trafficsafety.MainActivity;
import tw.edu.fju.trafficsafety.R;

/**
 * 背景守護模式：前景服務持續取得位置（或沿路線模擬），接近危險路口時用浮動通知＋語音＋震動提醒。
 * 使用者在 App 內開啟（App 在前景時啟動），之後切到 Google 地圖等其他 App 仍會持續運作。
 */
public class GuardianService extends Service {
    static final String TAG = "Guardian";
    static final String CH_STATUS = "guardian_status";
    static final String CH_ALERT = "guardian_alert";
    static final String CH_HISTORY = "guardian_history";
    static final int ID_STATUS = 7101;
    static final int ID_ALERT = 7102;
    static final double RELOAD_KM = 1.5;   // 離上次下載中心超過就重新下載附近路口
    static final int RADIUS_M = 3000;      // 每次下載半徑

    /** 讓外掛取得目前狀態（同一個行程內）。 */
    static volatile GuardianService instance;
    static volatile StatusListener listener;

    interface StatusListener { void onStatus(JSONObject status); }

    private final GuardianEngine engine = new GuardianEngine();
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private final Handler main = new Handler(Looper.getMainLooper());
    private FusedLocationProviderClient fused;
    private LocationCallback callback;
    private TextToSpeech tts;
    private boolean ttsReady;
    private String server = "";
    private double loadLat = Double.NaN, loadLon = Double.NaN;
    private boolean loading;
    private double lastLat = Double.NaN, lastLon = Double.NaN;
    private long lastStatusAt;
    private String lastAlertText = "";
    private boolean highAccuracy;
    private int lastAlertId;
    private IslandOverlay island;
    private boolean elder;

    // 模擬（展示用）：沿路線移動
    private List<double[]> simRoute;
    private double simSpeed = 1.4, simDist;
    private double[] simCum;
    private Runnable simTick;

    public static boolean isRunning() { return instance != null; }

    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;
        createChannels(this);
        island = new IslandOverlay(this);
        fused = LocationServices.getFusedLocationProviderClient(this);
        tts = new TextToSpeech(this, status -> {
            if (status == TextToSpeech.SUCCESS) {
                int r = tts.setLanguage(Locale.TAIWAN);
                ttsReady = r != TextToSpeech.LANG_MISSING_DATA && r != TextToSpeech.LANG_NOT_SUPPORTED;
                tts.setAudioAttributes(new AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_ASSISTANCE_NAVIGATION_GUIDANCE) // 會暫時壓低其他 App（如導航）的聲音
                        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build());
            }
        });
        loadCache();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        Notification n = statusNotification("守護中", "正在取得位置…");
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(ID_STATUS, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION);
        } else {
            startForeground(ID_STATUS, n);
        }
        SharedPreferences sp = getSharedPreferences("guardian", MODE_PRIVATE);
        if (intent != null) {
            server = intent.getStringExtra("server") != null ? intent.getStringExtra("server") : server;
            engine.setUserMode(intent.getStringExtra("mode"));
            elder = intent.getBooleanExtra("elder", false);
            String sim = intent.getStringExtra("simulate");
            simSpeed = intent.getDoubleExtra("simSpeed", 1.4);
            sp.edit().putString("server", server).putString("mode", engine.getUserMode()).putBoolean("elder", elder).apply();
            stopSimulation();
            if (sim != null && !sim.isEmpty()) startSimulation(sim);
            else startLocationUpdates(false);
        } else {
            // 系統回收後以 START_STICKY 重新建立服務時 intent 為 null（Codex 審查 #1）：
            // 從儲存的設定恢復實際定位守護；展示模擬沒有意義，直接結束，避免顯示「守護中」卻沒有在定位
            if (sp.getBoolean("simulating", false)) {
                stopSelf();
                return START_NOT_STICKY;
            }
            engine.setUserMode(sp.getString("mode", "auto"));
            elder = sp.getBoolean("elder", false);
            startLocationUpdates(false);
        }
        // 長輩模式：提醒距離 ×1.3、語音放慢
        engine.setRadiusScale(elder ? 1.3 : 1.0);
        if (tts != null) tts.setSpeechRate(elder ? 0.85f : 1.0f);
        sp.edit().putBoolean("simulating", simRoute != null).apply();
        publish();
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        stopSimulation();
        if (island != null) island.removeNow();
        if (callback != null) fused.removeLocationUpdates(callback);
        if (tts != null) tts.shutdown();
        io.shutdownNow();
        instance = null;
        StatusListener l = listener;
        if (l != null) {
            try { l.onStatus(new JSONObject().put("running", false)); } catch (Exception ignored) { }
        }
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) { return null; }

    // ---------------------------------------------------------------- 定位

    @SuppressLint("MissingPermission") // 外掛啟動服務前已確認定位權限
    private void startLocationUpdates(boolean high) {
        if (callback != null) fused.removeLocationUpdates(callback);
        highAccuracy = high;
        LocationRequest req = new LocationRequest.Builder(high ? Priority.PRIORITY_HIGH_ACCURACY : Priority.PRIORITY_BALANCED_POWER_ACCURACY,
                high ? 3000 : 10000).setMinUpdateDistanceMeters(high ? 3 : 15).build();
        callback = new LocationCallback() {
            @Override
            public void onLocationResult(@NonNull LocationResult result) {
                Location l = result.getLastLocation();
                if (l != null) onPosition(l.getLatitude(), l.getLongitude(), l.hasSpeed() ? l.getSpeed() : -1);
            }
        };
        try {
            fused.requestLocationUpdates(req, callback, Looper.getMainLooper());
        } catch (SecurityException e) {
            Log.w(TAG, "沒有定位權限", e);
            stopSelf();
        }
    }

    private void onPosition(double lat, double lon, double speed) {
        lastLat = lat;
        lastLon = lon;
        maybeReload(lat, lon);
        long now = System.currentTimeMillis();
        GuardianEngine.Alert a = engine.onLocation(lat, lon, speed, now);
        if (a != null) alert(a);
        // 離最近的危險路口 600 m 內才用高精度定位（省電）
        if (simRoute == null) {
            Object[] nb = engine.nearest(lat, lon);
            boolean near = nb != null && (double) nb[1] < 600;
            if (near != highAccuracy) startLocationUpdates(near);
        }
        if (now - lastStatusAt > 3000) {
            lastStatusAt = now;
            updateStatus(lat, lon, speed);
        }
    }

    // ---------------------------------------------------------------- 模擬（展示用）

    private void startSimulation(String json) {
        try {
            JSONArray arr = new JSONArray(json);
            simRoute = new ArrayList<>();
            for (int i = 0; i < arr.length(); i++) {
                JSONArray p = arr.getJSONArray(i);
                simRoute.add(new double[]{p.getDouble(0), p.getDouble(1)});
            }
            simCum = new double[simRoute.size()];
            for (int i = 1; i < simRoute.size(); i++) {
                double[] a = simRoute.get(i - 1), b = simRoute.get(i);
                simCum[i] = simCum[i - 1] + GuardianEngine.distance(a[0], a[1], b[0], b[1]);
            }
            simDist = 0;
            simTick = new Runnable() {
                @Override public void run() {
                    simDist += simSpeed;
                    double total = simCum[simCum.length - 1];
                    if (simDist >= total) {
                        double[] end = simRoute.get(simRoute.size() - 1);
                        onPosition(end[0], end[1], 0);
                        speak("模擬結束，已抵達目的地");
                        stopSelf();
                        return;
                    }
                    double[] p = positionAt(simDist);
                    onPosition(p[0], p[1], simSpeed);
                    main.postDelayed(this, 1000);
                }
            };
            main.post(simTick);
        } catch (Exception e) {
            Log.w(TAG, "模擬路線格式錯誤", e);
            startLocationUpdates(false);
        }
    }

    private double[] positionAt(double d) {
        int i = 1;
        while (i < simCum.length - 1 && simCum[i] < d) i++;
        double seg = Math.max(1e-6, simCum[i] - simCum[i - 1]);
        double t = Math.max(0, Math.min(1, (d - simCum[i - 1]) / seg));
        double[] a = simRoute.get(i - 1), b = simRoute.get(i);
        return new double[]{a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t};
    }

    private void stopSimulation() {
        if (simTick != null) main.removeCallbacks(simTick);
        simTick = null;
        simRoute = null;
    }

    // ---------------------------------------------------------------- 危險路口資料（伺服器＋快取）

    private void maybeReload(double lat, double lon) {
        if (loading || server.isEmpty()) return;
        boolean far = Double.isNaN(loadLat) || GuardianEngine.distance(lat, lon, loadLat, loadLon) > RELOAD_KM * 1000;
        if (!far && engine.size() > 0) return;
        loading = true;
        io.execute(() -> {
            try {
                URL url = new URL(server + "/api/hotspots/near?lat=" + lat + "&lon=" + lon + "&radius=" + RADIUS_M + "&limit=200");
                HttpURLConnection c = (HttpURLConnection) url.openConnection();
                c.setConnectTimeout(8000);
                c.setReadTimeout(15000);
                StringBuilder sb = new StringBuilder();
                try (BufferedReader r = new BufferedReader(new InputStreamReader(c.getInputStream(), StandardCharsets.UTF_8))) {
                    String line;
                    while ((line = r.readLine()) != null) sb.append(line);
                }
                JSONArray arr = new JSONObject(sb.toString()).getJSONArray("hotspots");
                engine.setHotspots(parse(arr));
                loadLat = lat;
                loadLon = lon;
                getSharedPreferences("guardian", MODE_PRIVATE).edit().putString("cache", arr.toString()).apply();
            } catch (Exception e) {
                Log.w(TAG, "下載危險路口失敗，使用快取", e);
            } finally {
                loading = false;
            }
        });
    }

    private void loadCache() {
        SharedPreferences sp = getSharedPreferences("guardian", MODE_PRIVATE);
        server = sp.getString("server", "");
        try {
            String c = sp.getString("cache", null);
            if (c != null) engine.setHotspots(parse(new JSONArray(c)));
        } catch (Exception ignored) { }
    }

    private static List<GuardianEngine.Hotspot> parse(JSONArray arr) throws Exception {
        List<GuardianEngine.Hotspot> list = new ArrayList<>();
        for (int i = 0; i < arr.length(); i++) {
            JSONObject o = arr.getJSONObject(i);
            list.add(new GuardianEngine.Hotspot(o.getInt("id"), o.getString("name"), o.getDouble("lat"), o.getDouble("lon"),
                    o.optString("level", "low"), o.optInt("accident_count", 0)));
        }
        return list;
    }

    // ---------------------------------------------------------------- 提醒

    private void alert(GuardianEngine.Alert a) {
        GuardianEngine.Hotspot h = a.hotspot;
        int meters = (int) Math.round(a.distance / 10.0) * 10;
        String level = "high".equals(h.level) ? "高風險" : "medium".equals(h.level) ? "中風險" : "注意";
        String title = "⚠ 前方危險路口・" + level;
        String text = h.name + "・約 " + meters + " 公尺・歷史事故 " + h.accidents + " 件";
        String tip = "car".equals(a.mode) ? "請減速，注意轉彎車與機車" : "bike".equals(a.mode) ? "請減速，注意左右來車與開車門" : "過馬路前左右看，別低頭看手機";
        lastAlertText = h.name + "（" + meters + " m）";
        // 有靈動島時由它負責畫面提醒，系統通知改為靜音紀錄（避免兩個提醒互相遮擋）；震動由 App 自己發出
        boolean useIsland = IslandOverlay.allowed(this);
        if (useIsland) vibrate();
        NotificationCompat.Builder b = new NotificationCompat.Builder(this, useIsland ? CH_HISTORY : CH_ALERT)
                .setSmallIcon(R.drawable.ic_stat_guardian)
                .setContentTitle(title)
                .setContentText(text)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(text + "\n" + tip + "\n依官方歷史事故統計提醒注意，不保證路況安全"))
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setCategory(NotificationCompat.CATEGORY_NAVIGATION)
                .setColor(0xFFFF3B30)
                .setVibrate(new long[]{0, 350, 150, 350})
                .setAutoCancel(true)
                .setTimeoutAfter(20000)
                // 指定獨立群組：避免被系統和常駐通知自動合併（合併後會降成低重要性、不會彈出橫幅）
                .setGroup("guardian_alert_" + h.id)
                .setGroupAlertBehavior(NotificationCompat.GROUP_ALERT_ALL)
                .setContentIntent(openApp());
        try {
            NotificationManagerCompat nm = NotificationManagerCompat.from(this);
            if (lastAlertId != 0) nm.cancel(lastAlertId);
            lastAlertId = ID_ALERT + 1 + (h.id % 5000); // 每個路口用不同編號，才會被當成新的提醒彈出
            nm.notify(lastAlertId, b.build());
        } catch (SecurityException e) {
            Log.w(TAG, "沒有通知權限", e);
        }
        // 靈動島懸浮提醒（有「顯示在其他應用程式上層」權限時）
        int color = "high".equals(h.level) ? 0xFFFF3B30 : "medium".equals(h.level) ? 0xFFFF9500 : 0xFFF5B800;
        island.show("前方危險路口・" + level, h.name + "・" + meters + " 公尺・事故 " + h.accidents + " 件", color, 7000);
        speak("注意，前方約" + meters + "公尺，" + h.name.replace("/", "與") + "路口，事故多發，" + tip);
        publish();
    }

    @SuppressWarnings("deprecation")
    private void vibrate() {
        long[] pattern = {0, 350, 150, 350};
        try {
            android.os.Vibrator v = Build.VERSION.SDK_INT >= 31
                    ? ((android.os.VibratorManager) getSystemService(Context.VIBRATOR_MANAGER_SERVICE)).getDefaultVibrator()
                    : (android.os.Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
            if (v == null || !v.hasVibrator()) return; // 平板常沒有震動馬達
            if (Build.VERSION.SDK_INT >= 26) {
                v.vibrate(android.os.VibrationEffect.createWaveform(pattern, -1));
            } else {
                v.vibrate(pattern, -1); // Android 7（API 24–25）沒有 VibrationEffect（Codex 審查 #3）
            }
        } catch (RuntimeException ignored) { /* 震動失敗不影響其他提醒 */ }
    }

    private void speak(String s) {
        if (tts != null && ttsReady) {
            tts.setSpeechRate(elder ? 0.85f : 1.0f); // TTS 初始化完成後才會生效，所以每次播報前設定
            Bundle p = new Bundle();
            tts.speak(s, TextToSpeech.QUEUE_FLUSH, p, "guardian-" + System.currentTimeMillis());
        }
    }

    // ---------------------------------------------------------------- 狀態列與狀態回報

    private void updateStatus(double lat, double lon, double speed) {
        String mode = engine.effectiveMode(speed);
        String modeText = "transit".equals(mode) ? "搭乘大眾運輸（暫停提醒）" : "car".equals(mode) ? "開車" : "bike".equals(mode) ? "騎車" : "步行";
        Object[] nb = engine.nearest(lat, lon);
        String body = nb == null ? "附近沒有危險路口資料" :
                "最近：" + ((GuardianEngine.Hotspot) nb[0]).name + "（" + Math.round((double) nb[1]) + " 公尺）";
        try {
            NotificationManagerCompat.from(this).notify(ID_STATUS, statusNotification("守護中・" + modeText + (simRoute != null ? "（展示模擬）" : ""), body));
        } catch (SecurityException ignored) { }
        publish();
    }

    private Notification statusNotification(String title, String text) {
        return new NotificationCompat.Builder(this, CH_STATUS)
                .setSmallIcon(R.drawable.ic_stat_guardian)
                .setContentTitle(title)
                .setContentText(text)
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setSilent(true)
                .setGroup("guardian_status")
                .setColor(0xFF0A84FF)
                .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
                .setContentIntent(openApp())
                .build();
    }

    private PendingIntent openApp() {
        Intent i = new Intent(this, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        return PendingIntent.getActivity(this, 0, i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    JSONObject status() {
        JSONObject o = new JSONObject();
        try {
            o.put("running", true).put("mode", engine.getUserMode()).put("simulating", simRoute != null)
                    .put("hotspots", engine.size()).put("lastAlert", lastAlertText);
            if (!Double.isNaN(lastLat)) {
                o.put("lat", lastLat).put("lon", lastLon);
                Object[] nb = engine.nearest(lastLat, lastLon);
                if (nb != null) o.put("nearest", ((GuardianEngine.Hotspot) nb[0]).name).put("nearestM", Math.round((double) nb[1]));
            }
        } catch (Exception ignored) { }
        return o;
    }

    private void publish() {
        StatusListener l = listener;
        if (l != null) l.onStatus(status());
    }

    static void createChannels(Context ctx) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = ctx.getSystemService(NotificationManager.class);
        NotificationChannel s = new NotificationChannel(CH_STATUS, "守護模式狀態", NotificationManager.IMPORTANCE_LOW);
        s.setDescription("背景守護模式執行中的常駐通知");
        NotificationChannel a = new NotificationChannel(CH_ALERT, "危險路口提醒", NotificationManager.IMPORTANCE_HIGH);
        a.setDescription("接近危險路口時跳出提醒");
        a.enableVibration(true);
        a.setVibrationPattern(new long[]{0, 350, 150, 350});
        NotificationChannel hist = new NotificationChannel(CH_HISTORY, "提醒紀錄（靈動島開啟時）", NotificationManager.IMPORTANCE_LOW);
        hist.setDescription("已用靈動島提醒時，通知欄只留下靜音紀錄");
        nm.createNotificationChannel(s);
        nm.createNotificationChannel(a);
        nm.createNotificationChannel(hist);
    }
}
