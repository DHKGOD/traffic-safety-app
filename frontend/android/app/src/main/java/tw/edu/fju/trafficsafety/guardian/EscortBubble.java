package tw.edu.fju.trafficsafety.guardian;

import android.animation.ObjectAnimator;
import android.animation.ValueAnimator;
import android.annotation.SuppressLint;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.PixelFormat;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.WindowManager;
import android.widget.LinearLayout;
import android.widget.TextView;

import tw.edu.fju.trafficsafety.MainActivity;

/**
 * 導航護航的浮動小圖示：守護模式執行中常駐在螢幕邊緣（例如開著 Google 地圖導航時），
 * 顯示離最近危險路口的距離；接近時變紅並跳動。可拖曳，放開後貼齊左右邊；點一下回到 App。
 * 需要「顯示在其他應用程式上層」權限（與靈動島相同）。
 */
public class EscortBubble {
    static final int SIZE = 46; // dp；使用者回饋 64 太大
    private final Context ctx;
    private final WindowManager wm;
    private final Handler main = new Handler(Looper.getMainLooper());
    private volatile LinearLayout view;
    private LinearLayout tip;        // 小球旁邊彈出的提醒膠囊
    private Runnable tipHide;
    private TextView label;
    private GradientDrawable bg;
    private WindowManager.LayoutParams lp;
    private ObjectAnimator pulse;
    private Runnable calm;

    public EscortBubble(Context ctx) {
        this.ctx = ctx.getApplicationContext();
        this.wm = (WindowManager) ctx.getSystemService(Context.WINDOW_SERVICE);
    }

    private int dp(float v) {
        return Math.round(TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, ctx.getResources().getDisplayMetrics()));
    }

    public void show() {
        main.post(() -> {
            if (view != null || !IslandOverlay.allowed(ctx)) return;
            view = build();
            lp = new WindowManager.LayoutParams(dp(SIZE), dp(SIZE),
                    Build.VERSION.SDK_INT >= Build.VERSION_CODES.O ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
                            : WindowManager.LayoutParams.TYPE_PHONE,
                    WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
                    PixelFormat.TRANSLUCENT);
            lp.gravity = Gravity.TOP | Gravity.START;
            int h = ctx.getResources().getDisplayMetrics().heightPixels;
            // 左側中間：Google 地圖導航時右側整排都是按鈕（指南針、搜尋、聲音），實機發現會蓋到指南針
            lp.x = dp(6);
            lp.y = (int) (h * 0.42);
            try {
                wm.addView(view, lp);
            } catch (Exception e) {
                view = null;
                return;
            }
            if (hiddenByApp) view.setVisibility(android.view.View.GONE);
            view.setScaleX(0.2f);
            view.setScaleY(0.2f);
            view.animate().scaleX(1f).scaleY(1f).setDuration(320).start();
        });
    }

    /** 更新顯示：meters 為到最近危險路口的距離（<0 表示不知道），level 決定顏色。 */
    public void update(int meters, String level) {
        main.post(() -> {
            if (view == null) return;
            if (calm != null) return; // 提醒中先維持紅色
            label.setText(meters < 0 ? "護航" : meters >= 1000 ? String.format(java.util.Locale.US, "%.1f\nkm", meters / 1000.0) : meters + "\nm");
            bg.setColor(meters >= 0 && meters < 300 ? colorOf(level) : 0xFF0A84FF);
        });
    }

    /** 接近危險路口：變紅、跳動幾秒。 */
    public void alert(int meters, String level) {
        main.post(() -> {
            if (view == null) return;
            label.setText("⚠\n" + meters + "m");
            bg.setColor(colorOf(level));
            if (pulse != null) pulse.cancel();
            pulse = ObjectAnimator.ofFloat(view, "scaleX", 1f, 1.15f);
            pulse.setRepeatCount(9);
            pulse.setRepeatMode(ValueAnimator.REVERSE);
            pulse.setDuration(260);
            pulse.addUpdateListener(a -> view.setScaleY((float) a.getAnimatedValue()));
            pulse.start();
            if (calm != null) main.removeCallbacks(calm);
            calm = () -> { calm = null; if (view != null) { view.setScaleX(1f); view.setScaleY(1f); } };
            main.postDelayed(calm, 7000);
        });
    }

    /** 小球目前看得到（有建立、沒有因為回到本 App 而藏起來），可以在旁邊彈出提醒。 */
    public boolean canShowTip() {
        return view != null && !hiddenByApp;
    }

    /**
     * 在小球旁邊彈出單行提醒（「小球旁邊」提醒方式）：自動偵測小球左右兩側哪邊空間大就往哪邊彈，
     * 放不下時縮短文字；不佔用螢幕上方，不會擋到 Google 地圖導航的轉彎提示（使用者提議）。
     */
    public void showTip(String title, String subtitle, int levelColor, long durationMs) {
        main.post(() -> {
            if (view == null || hiddenByApp) return;
            removeTip();
            int screenW = ctx.getResources().getDisplayMetrics().widthPixels;
            int size = dp(SIZE), gap = dp(8), margin = dp(8);
            int leftSpace = lp.x - gap - margin;
            int rightSpace = screenW - (lp.x + size) - gap - margin;
            boolean toRight = rightSpace >= leftSpace;
            int avail = Math.max(dp(140), toRight ? rightSpace : leftSpace);
            LinearLayout p = IslandOverlay.pill(ctx, title, subtitle, levelColor, 0);
            int unspec = android.view.View.MeasureSpec.makeMeasureSpec(0, android.view.View.MeasureSpec.UNSPECIFIED);
            p.measure(unspec, unspec);
            if (p.getMeasuredWidth() > avail) { // 太長：縮短標題（風險等級），距離一定保留
                TextView t = (TextView) p.getChildAt(1);
                t.setMaxWidth(Math.max(dp(36), t.getMeasuredWidth() - (p.getMeasuredWidth() - avail)));
                p.measure(unspec, unspec);
            }
            int w = Math.min(p.getMeasuredWidth(), avail), h = p.getMeasuredHeight();
            WindowManager.LayoutParams tl = new WindowManager.LayoutParams(
                    WindowManager.LayoutParams.WRAP_CONTENT, WindowManager.LayoutParams.WRAP_CONTENT,
                    Build.VERSION.SDK_INT >= Build.VERSION_CODES.O ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
                            : WindowManager.LayoutParams.TYPE_PHONE,
                    WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
                    PixelFormat.TRANSLUCENT);
            tl.gravity = Gravity.TOP | Gravity.START;
            tl.x = toRight ? lp.x + size + gap : lp.x - gap - w;
            tl.y = lp.y + (size - h) / 2;
            p.setOnClickListener(v -> {
                removeTip();
                Intent i = new Intent(ctx, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
                ctx.startActivity(i);
            });
            try {
                wm.addView(p, tl);
            } catch (Exception e) {
                return;
            }
            tip = p;
            // 從小球那一側長出來
            p.setPivotX(toRight ? 0 : w);
            p.setPivotY(h / 2f);
            p.setScaleX(0.2f);
            p.setAlpha(0f);
            p.animate().scaleX(1f).alpha(1f).setDuration(320).start();
            tipHide = () -> {
                LinearLayout cur = tip;
                if (cur == null) return;
                cur.animate().scaleX(0.2f).alpha(0f).setDuration(220).withEndAction(this::removeTip).start();
            };
            main.postDelayed(tipHide, durationMs);
        });
    }

    private void removeTip() {
        if (tipHide != null) main.removeCallbacks(tipHide);
        tipHide = null;
        if (tip != null) {
            try { wm.removeViewImmediate(tip); } catch (Exception ignored) { }
            tip = null;
        }
    }

    /** 回到本 App 時先藏起來（App 自己的畫面已有完整資訊），離開 App 再出現。 */
    public void setHidden(boolean hidden) {
        main.post(() -> {
            hiddenByApp = hidden;
            if (hidden) removeTip();
            if (view != null) view.setVisibility(hidden ? android.view.View.GONE : android.view.View.VISIBLE);
        });
    }

    private volatile boolean hiddenByApp;

    public void remove() {
        main.post(() -> {
            removeTip();
            if (pulse != null) pulse.cancel();
            if (calm != null) main.removeCallbacks(calm);
            calm = null;
            if (view != null) {
                try { wm.removeViewImmediate(view); } catch (Exception ignored) { }
                view = null;
            }
        });
    }

    private static int colorOf(String level) {
        return "high".equals(level) ? 0xFFFF3B30 : "medium".equals(level) ? 0xFFFF9500 : 0xFFF5B800;
    }

    @SuppressLint("ClickableViewAccessibility")
    private LinearLayout build() {
        LinearLayout root = new LinearLayout(ctx);
        root.setGravity(Gravity.CENTER);
        bg = new GradientDrawable();
        bg.setShape(GradientDrawable.OVAL);
        bg.setColor(0xFF0A84FF);
        bg.setStroke(dp(2), Color.WHITE);
        root.setBackground(bg);
        root.setElevation(dp(10));
        label = new TextView(ctx);
        label.setText("護航");
        label.setTextColor(Color.WHITE);
        label.setTypeface(Typeface.DEFAULT_BOLD);
        label.setTextSize(TypedValue.COMPLEX_UNIT_SP, 10);
        label.setGravity(Gravity.CENTER);
        label.setLineSpacing(0, 0.85f);
        root.addView(label);

        // 拖曳；移動很少時視為點一下（回到 App）
        final float[] start = new float[4];
        root.setOnTouchListener((v, e) -> {
            switch (e.getActionMasked()) {
                case MotionEvent.ACTION_DOWN:
                    removeTip(); // 拖動小球時先收起旁邊的提醒
                    start[0] = e.getRawX(); start[1] = e.getRawY(); start[2] = lp.x; start[3] = lp.y;
                    return true;
                case MotionEvent.ACTION_MOVE:
                    lp.x = (int) (start[2] + e.getRawX() - start[0]);
                    lp.y = (int) (start[3] + e.getRawY() - start[1]);
                    try { wm.updateViewLayout(view, lp); } catch (Exception ignored) { }
                    return true;
                case MotionEvent.ACTION_UP:
                    float moved = Math.abs(e.getRawX() - start[0]) + Math.abs(e.getRawY() - start[1]);
                    if (moved < dp(8)) {
                        Intent i = new Intent(ctx, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
                        ctx.startActivity(i);
                    } else {
                        snapToEdge();
                    }
                    return true;
                default:
                    return false;
            }
        });
        return root;
    }

    private void snapToEdge() {
        int w = ctx.getResources().getDisplayMetrics().widthPixels;
        int target = lp.x + dp(SIZE / 2) < w / 2 ? dp(6) : w - dp(SIZE) - dp(6);
        ValueAnimator a = ValueAnimator.ofInt(lp.x, target);
        a.setDuration(220);
        a.addUpdateListener(an -> {
            if (view == null) return;
            lp.x = (int) an.getAnimatedValue();
            try { wm.updateViewLayout(view, lp); } catch (Exception ignored) { }
        });
        a.start();
    }
}
