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
 */
public class MainActivity extends Activity {

    /** SYSTEM_UI_FLAG_* gộp sẵn: các hằng số này chỉ có từ API 19 nên dùng giá trị thô. */
    private static final int IMMERSIVE =
            0x00000002 | 0x00000004 | 0x00000100 | 0x00000200 | 0x00000400 | 0x00001000;
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
        s.setAllowFileAccess(true);
        s.setDatabaseEnabled(true);
        s.setLoadWithOverviewMode(false);
        s.setUseWideViewPort(false);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setUserAgentString(s.getUserAgentString() + " OneLineApp/Android");

        web.setWebChromeClient(new WebChromeClient());
        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                if (url.startsWith(NATIVE_LOGIN)) {
                    String target = Uri.parse(url).getQueryParameter("url");
                    if (target != null && target.startsWith("https://")) openBrowser(target);
                    return true;
                }
                if (url.startsWith("http://") || url.startsWith("https://")) {   // link ngoài: mở trình duyệt
                    openBrowser(url);
                    return true;
                }
                return false;
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
        web.loadUrl("file:///android_asset/index.html");
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
        if (data != null && AUTH_SCHEME.equals(data.getScheme())) {
            pendingAuth = data.toString();
            flushAuth();
        }
    }

    /** Giao kết quả đăng nhập cho game khi trang đã tải xong. */
    private void flushAuth() {
        if (pendingAuth == null || !pageReady || web == null) return;
        String js = "javascript:window.OneLineNativeLogin&&window.OneLineNativeLogin("
                + jsString(pendingAuth) + ")";
        pendingAuth = null;
        web.loadUrl(js);
    }

    /**
     * Chuỗi JS an toàn để nhúng vào URL javascript:. Thoát cả '%' (thành \u0025) vì WebView giải mã
     * %xx trong URL javascript:, làm hỏng token (dấu '+' sẽ bị đọc thành khoảng trắng).
     */
    private static String jsString(String s) {
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

    private void openBrowser(String url) {
        try {
            Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
            i.addCategory(Intent.CATEGORY_BROWSABLE);
            startActivity(i);
        } catch (Exception e) {
            // không có trình duyệt nào: bỏ qua
        }
    }

    private void hideBars() {
        if (Build.VERSION.SDK_INT >= 19) {
            getWindow().getDecorView().setSystemUiVisibility(IMMERSIVE);
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
    }

    @Override
    protected void onDestroy() {
        if (web != null) {
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
