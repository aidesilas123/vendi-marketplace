package com.vendi.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.os.Bundle;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.app.RemoteInput;
import androidx.core.content.ContextCompat;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;

import org.json.JSONObject;

public class MainActivity extends BridgeActivity {
    private BroadcastReceiver foregroundPushReceiver;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Edge-to-edge from the very first frame: the window extends under the
        // system bars immediately, so there is never an opaque-bar "shadow" that
        // vanishes a second later and resizes the page (the launch jerk).
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        super.onCreate(savedInstanceState);
        handleNotificationIntent(getIntent());
        registerForegroundPushReceiver();
    }

    @Override
    public void onDestroy() {
        if (foregroundPushReceiver != null) {
            try {
                unregisterReceiver(foregroundPushReceiver);
            } catch (Exception ignored) {}
            foregroundPushReceiver = null;
        }
        super.onDestroy();
    }

    /**
     * VendiMessagingService forwards foreground pushes as an in-app broadcast;
     * relay them to the WebView as `vendi-push-received` events (PushBanner).
     */
    private void registerForegroundPushReceiver() {
        foregroundPushReceiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                String title = intent.getStringExtra("title");
                if (title == null || title.isEmpty()) return;
                String body = intent.getStringExtra("body");
                String route = intent.getStringExtra("route");
                try {
                    JSONObject detail = new JSONObject();
                    detail.put("title", title);
                    detail.put("body", body != null ? body : "");
                    detail.put("route", route != null ? route : "");
                    String js = "window.dispatchEvent(new CustomEvent('vendi-push-received',{detail:"
                            + detail.toString() + "}));";
                    WebView webView = getBridge().getWebView();
                    if (webView != null) {
                        webView.post(() -> webView.evaluateJavascript(js, null));
                    }
                } catch (Exception ignored) {}
            }
        };
        IntentFilter filter = new IntentFilter(VendiMessagingService.ACTION_FOREGROUND_PUSH);
        ContextCompat.registerReceiver(this, foregroundPushReceiver, filter, ContextCompat.RECEIVER_NOT_EXPORTED);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleNotificationIntent(intent);
    }

    /**
     * Deep links fired from our native chat notifications (content tap and the
     * inline Reply box). The route is delivered two ways: a JS CustomEvent when
     * the WebView is already alive, plus a CapacitorStorage fallback the app
     * checks on cold start (AppShell reads "vendi_pending_route").
     */
    private void handleNotificationIntent(Intent intent) {
        if (intent == null) return;
        String action = intent.getAction();
        if (action == null) return;

        if (VendiMessagingService.ACTION_DEEP_LINK.equals(action)) {
            String route = intent.getStringExtra("route");
            intent.setAction(null); // don't re-fire on rotation
            if (route != null && !route.isEmpty()) dispatchDeepLink(route);
            return;
        }

        if (VendiMessagingService.ACTION_QUICK_REPLY.equals(action)) {
            android.os.Bundle results = RemoteInput.getResultsFromIntent(intent);
            CharSequence text = results != null
                    ? results.getCharSequence(VendiMessagingService.REMOTE_INPUT_KEY)
                    : null;
            String route = intent.getStringExtra("route");
            int notifId = intent.getIntExtra("notif_id", 0);
            intent.setAction(null); // don't re-fire on rotation
            if (notifId != 0) {
                try {
                    NotificationManagerCompat.from(this).cancel(notifId);
                } catch (Exception ignored) {}
            }
            if (text == null || text.length() == 0 || route == null || route.isEmpty()) return;
            try {
                String deepLink = route + (route.contains("?") ? "&" : "?")
                        + "quickReply=" + java.net.URLEncoder.encode(text.toString(), "UTF-8");
                dispatchDeepLink(deepLink);
            } catch (Exception ignored) {}
        }
    }

    private void dispatchDeepLink(String route) {
        // 1. Persist for cold start.
        try {
            SharedPreferences prefs = getSharedPreferences("CapacitorStorage", MODE_PRIVATE);
            prefs.edit().putString("vendi_pending_route", route).apply();
        } catch (Exception ignored) {}
        // 2. If the WebView is alive, deliver immediately.
        try {
            WebView webView = getBridge().getWebView();
            if (webView != null) {
                String js = "window.dispatchEvent(new CustomEvent('vendi-deep-link',{detail:"
                        + JSONObject.quote(route) + "}));";
                webView.post(() -> webView.evaluateJavascript(js, null));
            }
        } catch (Exception ignored) {}
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
