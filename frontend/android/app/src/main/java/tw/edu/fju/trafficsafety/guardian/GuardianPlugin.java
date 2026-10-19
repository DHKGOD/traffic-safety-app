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

/** JS 介面：Guardian.start / stop / status / testAlert，事件 guardianStatus。 */
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
        if (call.getArray("simulate") != null) {
            i.putExtra("simulate", call.getArray("simulate").toString());
            i.putExtra("simSpeed", call.getDouble("simSpeed", 1.4));
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
