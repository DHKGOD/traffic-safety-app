package tw.edu.fju.trafficsafety.guardian;

import android.Manifest;
import android.content.Intent;
import android.os.Build;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import org.json.JSONObject;

import tw.edu.fju.trafficsafety.R;

/** JS 介面：Guardian.start / stop / status / testAlert / walkAlert，事件 guardianStatus。 */
@CapacitorPlugin(
        name = "Guardian",
        permissions = {
                @Permission(alias = "location", strings = {Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION}),
                @Permission(alias = "notifications", strings = {"android.permission.POST_NOTIFICATIONS"})
        })
public class GuardianPlugin extends Plugin {

    @Override
    public void load() {
        GuardianService.createChannels(getContext());
        GuardianService.listener = (JSONObject status) -> {
            try { notifyListeners("guardianStatus", JSObject.fromJSONObject(status)); } catch (Exception ignored) { }
        };
    }

    @Override
    protected void handleOnResume() {
        super.handleOnResume();
        GuardianService.setAppVisible(true);
    }

    @Override
    protected void handleOnPause() {
        super.handleOnPause();
        GuardianService.setAppVisible(false);
    }

    private boolean needNotif() {
        return Build.VERSION.SDK_INT >= 33 && getPermissionState("notifications") != PermissionState.GRANTED;
    }

    @PluginMethod
    public void start(PluginCall call) {
        boolean simulate = call.getArray("simulate") != null;
        // 模擬展示不需要定位權限；實際守護需要
        if ((!simulate && getPermissionState("location") != PermissionState.GRANTED) || needNotif()) {
            requestAllPermissions(call, "permsCallback");
            return;
        }
        doStart(call);
    }

    @PermissionCallback
    private void permsCallback(PluginCall call) {
        boolean simulate = call.getArray("simulate") != null;
        if (!simulate && getPermissionState("location") != PermissionState.GRANTED) {
            call.reject("需要定位權限才能使用守護模式", "NO_LOCATION");
            return;
        }
        if (needNotif()) {
            call.reject("需要通知權限才能跳出提醒", "NO_NOTIFICATION");
            return;
        }
        doStart(call);
    }

    private void doStart(PluginCall call) {
        Intent i = new Intent(getContext(), GuardianService.class);
        i.putExtra("server", call.getString("server", ""));
        i.putExtra("mode", call.getString("mode", "auto"));
        i.putExtra("elder", call.getBoolean("elder", false));
        i.putExtra("source", call.getString("source", "guardian"));
        if (call.getArray("simulate") != null) {
            i.putExtra("simulate", call.getArray("simulate").toString());
            i.putExtra("simSpeed", call.getDouble("simSpeed", 1.4));
            // App 內模擬行走交給背景：同一組路線危險路口、已提醒過的編號
            if (call.getArray("simHotspots") != null) i.putExtra("simHotspots", call.getArray("simHotspots").toString());
            if (call.getArray("simSkip") != null) i.putExtra("simSkip", call.getArray("simSkip").toString());
        }
        ContextCompat.startForegroundService(getContext(), i);
        JSObject r = new JSObject();
        r.put("running", true);
        call.resolve(r);
    }

    @PluginMethod
    public void stop(PluginCall call) {
        getContext().stopService(new Intent(getContext(), GuardianService.class));
        JSObject r = new JSObject();
        r.put("running", false);
        call.resolve(r);
    }

    @PluginMethod
    public void status(PluginCall call) {
        GuardianService s = GuardianService.instance;
        try {
            call.resolve(s == null ? new JSObject().put("running", false) : JSObject.fromJSONObject(s.status()));
        } catch (Exception e) {
            call.reject(e.getMessage());
        }
    }

    /** 「靈動島」懸浮提醒是否已取得「顯示在其他應用程式上層」權限。 */
    @PluginMethod
    public void overlayStatus(PluginCall call) {
        JSObject r = new JSObject();
        r.put("allowed", IslandOverlay.allowed(getContext()));
        call.resolve(r);
    }

    /** 打開系統設定頁，讓使用者開啟「顯示在其他應用程式上層」。 */
    @PluginMethod
    public void requestOverlay(PluginCall call) {
        if (IslandOverlay.allowed(getContext())) {
            JSObject r = new JSObject();
            r.put("allowed", true);
            call.resolve(r);
            return;
        }
        Intent i = new Intent(android.provider.Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                android.net.Uri.parse("package:" + getContext().getPackageName()));
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(i);
        JSObject r = new JSObject();
        r.put("allowed", false);
        r.put("opened", true);
        call.resolve(r);
    }

    private IslandOverlay island;
    private int lastNotifyId;

    /**
     * App 內模擬行走接近危險路口時呼叫：跳出系統通知＋靈動島＋震動（語音由 App 自己播）。
     * 參數：id、name、level、meters、accidents、tip。沒有通知權限時會先詢問。
     */
    @PluginMethod
    public void walkAlert(PluginCall call) {
        if (needNotif()) {
            requestPermissionForAlias("notifications", call, "notifyCallback");
            return;
        }
        sendNotify(call);
    }

    @PermissionCallback
    private void notifyCallback(PluginCall call) {
        if (needNotif()) call.reject("需要通知權限", "NO_NOTIFICATION");
        else sendNotify(call);
    }

    private void sendNotify(PluginCall call) {
        if (island == null) island = new IslandOverlay(getContext());
        String level = call.getString("level", "low");
        String levelText = "high".equals(level) ? "高風險" : "medium".equals(level) ? "中風險" : "注意";
        String name = call.getString("name", "危險路口");
        int meters = call.getInt("meters", 0);
        int accidents = call.getInt("accidents", 0);
        String text = name + "・約 " + meters + " 公尺・歷史事故 " + accidents + " 件";
        lastNotifyId = GuardianService.postAlert(getContext(), island, lastNotifyId, call.getInt("id", 0),
                "⚠ 前方危險路口・" + levelText, text, text + "\n" + call.getString("tip", "請減速並注意左右來車"), level,
                "前方危險路口・" + levelText, name + "・" + meters + " 公尺・事故 " + accidents + " 件");
        JSObject r = new JSObject();
        r.put("overlay", IslandOverlay.allowed(getContext()));
        call.resolve(r);
    }

    /**
     * 導航護航：打開 Google 地圖導航到終點（mode：foot→步行、bike→機車、car→開車）。
     * 沒裝 Google 地圖時改用一般地圖連結，讓系統選擇地圖 App。
     */
    @PluginMethod
    public void openNavigation(PluginCall call) {
        Double lat = call.getDouble("lat"), lon = call.getDouble("lon");
        if (lat == null || lon == null) { call.reject("缺少終點座標"); return; }
        String m = call.getString("mode", "car");
        String gm = "foot".equals(m) ? "w" : "bike".equals(m) ? "l" : "d"; // l＝兩輪機車
        Intent i = new Intent(Intent.ACTION_VIEW, android.net.Uri.parse("google.navigation:q=" + lat + "," + lon + "&mode=" + gm));
        i.setPackage("com.google.android.apps.maps");
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        JSObject r = new JSObject();
        try {
            getContext().startActivity(i);
            r.put("app", "google");
        } catch (android.content.ActivityNotFoundException e) {
            Intent g = new Intent(Intent.ACTION_VIEW, android.net.Uri.parse("geo:" + lat + "," + lon + "?q=" + lat + "," + lon));
            g.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            try { getContext().startActivity(g); r.put("app", "other"); }
            catch (android.content.ActivityNotFoundException e2) { call.reject("手機上沒有地圖 App"); return; }
        }
        call.resolve(r);
    }

    /** 送出一則測試提醒（確認通知、聲音、權限都正常）。 */
    @PluginMethod
    public void testAlert(PluginCall call) {
        if (needNotif()) {
            requestPermissionForAlias("notifications", call, "testCallback");
            return;
        }
        sendTest(call);
    }

    @PermissionCallback
    private void testCallback(PluginCall call) {
        if (needNotif()) call.reject("需要通知權限", "NO_NOTIFICATION");
        else sendTest(call);
    }

    private void sendTest(PluginCall call) {
        NotificationCompat.Builder b = new NotificationCompat.Builder(getContext(), GuardianService.CH_ALERT)
                .setSmallIcon(R.drawable.ic_stat_guardian)
                .setContentTitle("⚠ 測試提醒：前方危險路口")
                .setContentText("這是測試。接近危險路口時會像這樣跳出提醒並語音播報。")
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setCategory(NotificationCompat.CATEGORY_NAVIGATION)
                .setColor(0xFFFF3B30)
                .setAutoCancel(true)
                .setTimeoutAfter(15000)
                .setGroup("guardian_test")
                .setGroupAlertBehavior(NotificationCompat.GROUP_ALERT_ALL);
        try {
            NotificationManagerCompat.from(getContext()).notify(GuardianService.ID_ALERT, b.build());
            new IslandOverlay(getContext()).show("測試提醒・前方危險路口", "中正路 / 思源路・80 公尺・事故 25 件", 0xFFFF3B30, 6000);
            JSObject r = new JSObject();
            r.put("overlay", IslandOverlay.allowed(getContext()));
            call.resolve(r);
        } catch (SecurityException e) {
            call.reject("沒有通知權限", "NO_NOTIFICATION");
        }
    }
}
