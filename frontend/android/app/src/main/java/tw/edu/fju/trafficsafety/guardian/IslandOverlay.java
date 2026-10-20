package tw.edu.fju.trafficsafety.guardian;

import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.PixelFormat;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.text.TextUtils;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.view.animation.OvershootInterpolator;
import android.widget.LinearLayout;
import android.widget.TextView;

import tw.edu.fju.trafficsafety.MainActivity;

/**
 * 「靈動島」懸浮提醒：在螢幕最上方畫一個黑色膠囊，展開顯示危險路口資訊，幾秒後收回。
 * 需要「顯示在其他應用程式上層」權限；不受手機通知彈出樣式（例如三星「簡要」）影響，
 * 開著 Google 地圖、滑 IG 時也看得到。
 */
public class IslandOverlay {
    private final Context ctx;
    private final WindowManager wm;
    private final Handler main = new Handler(Looper.getMainLooper());
    private LinearLayout view;
    private Runnable hide;

    public IslandOverlay(Context ctx) {
        this.ctx = ctx.getApplicationContext();
        this.wm = (WindowManager) ctx.getSystemService(Context.WINDOW_SERVICE);
    }

    public static boolean allowed(Context ctx) {
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.M || Settings.canDrawOverlays(ctx);
    }

    private int statusBarHeight() {
        int id = ctx.getResources().getIdentifier("status_bar_height", "dimen", "android");
        return id > 0 ? ctx.getResources().getDimensionPixelSize(id) : dp(28);
    }

    private int dp(float v) {
        return Math.round(TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, ctx.getResources().getDisplayMetrics()));
    }

    /** 顯示提醒；levelColor 為左側圓點顏色（高風險紅、中風險橘、注意黃）。 */
    public void show(String title, String subtitle, int levelColor, long durationMs) {
        main.post(() -> {
            if (!allowed(ctx)) return;
            removeNow();
            view = build(title, subtitle, levelColor);
            WindowManager.LayoutParams lp = new WindowManager.LayoutParams(
                    WindowManager.LayoutParams.WRAP_CONTENT, WindowManager.LayoutParams.WRAP_CONTENT,
                    Build.VERSION.SDK_INT >= Build.VERSION_CODES.O ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
                            : WindowManager.LayoutParams.TYPE_PHONE,
                    WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
                    PixelFormat.TRANSLUCENT);
            lp.gravity = Gravity.TOP | Gravity.CENTER_HORIZONTAL;
            // 放在狀態列正下方：放進狀態列時，系統的時間與圖示會畫在上面，字看不清楚（實機發現）。
            // 想完全不擋導航提示，請用「小球旁邊」提醒方式（預設）。
            lp.y = statusBarHeight() + dp(4);
            try {
                wm.addView(view, lp);
            } catch (Exception e) {
                view = null;
                return;
            }
            // 從小膠囊彈開（像動態島）
            view.setScaleX(0.35f);
            view.setScaleY(0.6f);
            view.setAlpha(0f);
            view.animate().scaleX(1f).scaleY(1f).alpha(1f).setDuration(420).setInterpolator(new OvershootInterpolator(1.4f)).start();
            hide = () -> {
                if (view == null) return;
                View v = view;
                v.animate().scaleX(0.35f).scaleY(0.6f).alpha(0f).setDuration(260).withEndAction(this::removeNow).start();
            };
            main.postDelayed(hide, durationMs);
        });
    }

    /**
     * 單行小膠囊：● 前方高風險路口　60 公尺（使用者回饋：騎車／開車只能瞄一眼，
     * 而且上方不能擋住 Google 地圖導航的轉彎提示，所以只放風險等級＋距離）。
     */
    private LinearLayout build(String title, String subtitle, int levelColor) {
        LinearLayout root = pill(ctx, title, subtitle, levelColor, 0);
        // 點一下打開 App
        root.setOnClickListener(v -> {
            removeNow();
            Intent i = new Intent(ctx, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            ctx.startActivity(i);
        });
        return root;
    }

    private static int dp(Context ctx, float v) {
        return Math.round(TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, ctx.getResources().getDisplayMetrics()));
    }

    /** 黑色單行膠囊（靈動島與小球旁提醒共用）。titleMaxPx > 0 時限制標題寬度，太長就省略。 */
    static LinearLayout pill(Context ctx, String title, String subtitle, int levelColor, int titleMaxPx) {
        java.util.function.IntUnaryOperator dp = v -> dp(ctx, v);
        LinearLayout root = new LinearLayout(ctx);
        root.setOrientation(LinearLayout.HORIZONTAL);
        root.setGravity(Gravity.CENTER_VERTICAL);
        root.setPadding(dp.applyAsInt(7), dp.applyAsInt(6), dp.applyAsInt(16), dp.applyAsInt(6));
        GradientDrawable bg = new GradientDrawable();
        bg.setColor(Color.BLACK);
        bg.setCornerRadius(dp.applyAsInt(22));
        root.setBackground(bg);
        root.setElevation(dp.applyAsInt(8));

        // 左側：風險顏色的小圓點（含「!」）
        TextView icon = new TextView(ctx);
        icon.setText("!");
        icon.setTextColor(Color.WHITE);
        icon.setTypeface(Typeface.DEFAULT_BOLD);
        icon.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15);
        icon.setGravity(Gravity.CENTER);
        GradientDrawable dot = new GradientDrawable();
        dot.setShape(GradientDrawable.OVAL);
        dot.setColor(levelColor);
        icon.setBackground(dot);
        LinearLayout.LayoutParams ilp = new LinearLayout.LayoutParams(dp.applyAsInt(28), dp.applyAsInt(28));
        ilp.rightMargin = dp.applyAsInt(9);
        root.addView(icon, ilp);

        TextView t = new TextView(ctx);
        t.setText(title);
        t.setTextColor(Color.WHITE);
        t.setTypeface(Typeface.DEFAULT_BOLD);
        t.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15);
        t.setSingleLine(true);
        t.setEllipsize(TextUtils.TruncateAt.END);
        if (titleMaxPx > 0) t.setMaxWidth(titleMaxPx);
        root.addView(t);

        if (subtitle != null && !subtitle.isEmpty()) {
            TextView s = new TextView(ctx);
            s.setText(subtitle);
            s.setTextColor(levelColor == 0xFFF5B800 ? 0xFFFFD84A : levelColor == 0xFFFF9500 ? 0xFFFFB340 : 0xFFFF6B5F);
            s.setTypeface(Typeface.DEFAULT_BOLD);
            s.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15);
            s.setSingleLine(true);
            LinearLayout.LayoutParams slp = new LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT);
            slp.leftMargin = dp.applyAsInt(10);
            root.addView(s, slp);
        }
        return root;
    }

    public void removeNow() {
        if (hide != null) main.removeCallbacks(hide);
        hide = null;
        if (view != null) {
            try { wm.removeViewImmediate(view); } catch (Exception ignored) { }
            view = null;
        }
    }
}
