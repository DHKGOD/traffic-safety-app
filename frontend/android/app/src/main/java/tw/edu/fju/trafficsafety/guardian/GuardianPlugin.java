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
                .setTimeoutAfter(15000);
        try {
            NotificationManagerCompat.from(getContext()).notify(GuardianService.ID_ALERT, b.build());
            call.resolve();
        } catch (SecurityException e) {
            call.reject("沒有通知權限", "NO_NOTIFICATION");
        }
    }
}
