package com.campus.marketplace;

import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;

public class MainActivity extends BridgeActivity {
    @Override
    public void onStart() {
        super.onStart();
        WebView webView = getBridge().getWebView();
        if (webView != null) {
            webView.setOverScrollMode(WebView.OVER_SCROLL_NEVER);

            // Bridge the REAL system-bar insets to CSS. env(safe-area-inset-*)
            // is unreliable on some WebViews (stale or 0 on first paint, wrong on
            // 3-button nav phones); these vars always carry the true values so the
            // app's bottom nav lifts exactly above the system bar — and drops back
            // to full-screen on gesture navigation. Density converts px -> CSS px.
            ViewCompat.setOnApplyWindowInsetsListener(webView, (v, insets) -> {
                androidx.core.graphics.Insets bars =
                        insets.getInsets(WindowInsetsCompat.Type.systemBars());
                float density = getResources().getDisplayMetrics().density;
                int top = Math.round(bars.top / density);
                int bottom = Math.round(bars.bottom / density);
                String js = "document.documentElement.style.setProperty('--native-sat','"
                        + top + "px');"
                        + "document.documentElement.style.setProperty('--native-sab','"
                        + bottom + "px');";
                v.post(() -> webView.evaluateJavascript(js, null));
                return insets;
            });
        }
    }
}
