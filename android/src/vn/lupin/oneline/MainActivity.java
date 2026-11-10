package vn.lupin.oneline;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.KeyEvent;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

/**
 * Vỏ WebView toàn màn hình cho game Đường Kẻ Một Nét (assets/index.html).
 *
 * Đăng nhập Google/Facebook: Google và Facebook chặn đăng nhập trong WebView, nên game điều hướng tới
 * oneline-native://login?url=... -> app mở trang đăng nhập bằng trình duyệt hệ thống; trình duyệt trả kết quả về
 * vn.lupin.oneline://auth?... -> app chuyển nguyên chuỗi đó cho window.OneLineNativeLogin trong game.
 *
 * Mã được biên dịch với android.jar API 16 (xem build.sh) nên API mới hơn gọi qua hằng số thô / reflection.
 */
public class MainActivity extends Activity {

    /** SYSTEM_UI_FLAG_* gộp sẵn: HIDE_NAVIGATION | FULLSCREEN | LAYOUT_* | IMMERSIVE_STICKY (API 19). */
    private static final int IMMERSIVE =
            0x00000002 | 0x00000004 | 0x00000100 | 0x00000200 | 0x00000400 | 0x00001000;
    private static final String ASSET_BASE = "file:///android_asset/";
    private static final String NATIVE_LOGIN = "oneline-native://login";
    private static final String AUTH_SCHEME = "vn.lupin.oneline";

    private WebView web;
    private String pendingAuth;
    private boolean pageReady;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        requestWindowFeature(Window.FEATURE_NO_TITLE);
        getWindow().setFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN,
                WindowManager.LayoutParams.FLAG_FULLSCREEN);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        web = new WebView(this);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(false);          // file:///android_asset vẫn đọc được; chặn mọi file khác trên máy
        s.setLoadWithOverviewMode(false);
        s.setUseWideViewPort(false);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setTextZoom(100);                   // không phóng chữ theo cỡ chữ hệ thống (làm vỡ bố cục)
        s.setUserAgentString(s.getUserAgentString() + " OneLineApp/Android");

        // Trò chơi dựa vào việc GIỮ ngón tay: nuốt sự kiện giữ-lâu để không bật chọn chữ / rung
        web.setOnLongClickListener(new View.OnLongClickListener() {
            @Override
            public boolean onLongClick(View v) {
                return true;
            }
        });
        web.setLongClickable(false);
        web.setHapticFeedbackEnabled(false);

        web.setWebChromeClient(new WebChromeClient());
        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                if (url.startsWith(ASSET_BASE)) return false;             // trang của game
                if (url.startsWith(NATIVE_LOGIN)) {
                    String target = Uri.parse(url).getQueryParameter("url");
                    if (target == null || !target.startsWith("https://")) reportAuth("failed");
                    else if (!openExternal(target)) reportAuth("no-browser");   // máy không có trình duyệt nào
                    return true;
                }
                if (url.startsWith("http://") || url.startsWith("https://") || url.startsWith("mailto:")) {
                    openExternal(url);                                    // link ngoài: mở bằng trình duyệt
                }
                return true;                                              // mọi thứ khác: không tải trong app
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                pageReady = true;
                flushAuth();
            }
        });
        web.setBackgroundColor(0xFF04060C);
        web.setVerticalScrollBarEnabled(false);
        web.setHorizontalScrollBarEnabled(false);
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);

        setContentView(web);
        handleIntent(getIntent());
        // Nạp trang SAU lượt dàn giao diện đầu tiên để WebView đã có kích thước khi trang chạy. Nạp ngay trong
        // onCreate thì trên Android 15+ trang thấy cửa sổ 0x0 và phải tự dàn lại sau (game có xử lý, nhưng chậm một nhịp).
        web.post(new Runnable() {
            @Override
            public void run() {
                if (web != null) web.loadUrl(ASSET_BASE + "index.html");
            }
        });
        hideBars();
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleIntent(intent);
    }

    private void handleIntent(Intent intent) {
        if (intent == null) return;
        Uri data = intent.getData();
        if (data != null && AUTH_SCHEME.equals(data.getScheme()) && "auth".equals(data.getHost())) {
            pendingAuth = data.toString();
            flushAuth();
        }
    }

    /** Giao kết quả đăng nhập cho game khi trang đã tải xong. */
    private void flushAuth() {
        if (pendingAuth == null || !pageReady || web == null) return;
        String uri = pendingAuth;
        pendingAuth = null;
        js("window.OneLineNativeLogin&&window.OneLineNativeLogin(" + jsString(uri) + ")");
    }

    /** Chạy một câu lệnh JS trong trang; void(...) để giá trị trả về không thay nội dung trang. */
    private void js(String code) {
        if (web != null && pageReady) web.loadUrl("javascript:void(" + code + ")");
    }

    /**
     * Chuỗi JS an toàn để nhúng vào URL javascript:. Thoát cả '%' (thành %) vì WebView giải mã
     * %xx trong URL javascript:, làm hỏng token (dấu '+' sẽ bị đọc thành khoảng trắng).
     */
    static String jsString(String s) {
        StringBuilder b = new StringBuilder("\"");
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            if (c == '"' || c == '\\') {
                b.append('\\').append(c);
            } else if (c < 0x20 || c > 0x7e || c == '%' || c == '<' || c == '>' || c == '\'') {
                String h = Integer.toHexString(c);
                b.append("\\u");
                for (int k = h.length(); k < 4; k++) b.append('0');
                b.append(h);
            } else {
                b.append(c);
            }
        }
        return b.append('"').toString();
    }

    /** Mở địa chỉ bằng ứng dụng ngoài (trình duyệt, thư...). Trả về false nếu máy không có ứng dụng nào mở được. */
    private boolean openExternal(String url) {
        try {
            Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
            i.addCategory(Intent.CATEGORY_BROWSABLE);
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(i);
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    /** Không mở được trang đăng nhập: báo ngay cho game để nút đăng nhập không kẹt ở trạng thái chờ. */
    private void reportAuth(String error) {
        pendingAuth = AUTH_SCHEME + "://auth?error=" + error;
        if (web != null) web.post(new Runnable() {
            @Override
            public void run() {
                flushAuth();
            }
        });
    }

    /** Ẩn thanh trạng thái + thanh điều hướng (vuốt từ mép để hiện tạm). */
    private void hideBars() {
        getWindow().getDecorView().setSystemUiVisibility(IMMERSIVE);
        if (Build.VERSION.SDK_INT >= 30) {
            try {   // WindowInsetsController (API 30+): cách chính thức trên Android mới, kể cả khi bị ép tràn viền
                Object ctl = Window.class.getMethod("getInsetsController").invoke(getWindow());
                if (ctl != null) {
                    Class<?> wic = Class.forName("android.view.WindowInsetsController");
                    int bars = (Integer) Class.forName("android.view.WindowInsets$Type").getMethod("systemBars").invoke(null);
                    wic.getMethod("setSystemBarsBehavior", int.class).invoke(ctl, 2);   // SHOW_TRANSIENT_BARS_BY_SWIPE
                    wic.getMethod("hide", int.class).invoke(ctl, bars);
                }
            } catch (Throwable t) {
                // đã có cờ kiểu cũ ở trên
            }
        }
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) hideBars();
    }

    @Override
    protected void onPause() {
        super.onPause();
        if (web != null) web.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (web != null) web.onResume();
        hideBars();
        js("window.OneLineNativeResume&&window.OneLineNativeResume()");   // nhả trạng thái "đang đăng nhập" nếu bỏ ngang
    }

    @Override
    protected void onDestroy() {
        if (web != null) {
            web.stopLoading();
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }

    @Override
    public boolean onKeyDown(int code, KeyEvent e) {
        if (code == KeyEvent.KEYCODE_BACK) {
            if (web != null && web.canGoBack()) web.goBack();   // từ trang quyền riêng tư về game
            else finish();
            return true;
        }
        return super.onKeyDown(code, e);
    }
}
