package com.campus.marketplace;

import android.os.Bundle;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Edge-to-edge from the very first frame: the window extends under the
        // system bars immediately, so there is never an opaque-bar "shadow" that
        // vanishes a second later and resizes the page (the launch jerk).
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        super.onCreate(savedInstanceState);
    }

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
            // The listener above only fires on inset CHANGES. If the system bars
            // were already applied before it attached, it never runs and
            // --native-sab stays unset — bottom bars then slide under the
            // 3-button nav. Force a dispatch so the vars are set on every launch.
            ViewCompat.requestApplyInsets(webView);
        }
    }
}
