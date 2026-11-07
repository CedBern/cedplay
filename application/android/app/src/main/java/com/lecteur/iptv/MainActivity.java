package com.lecteur.iptv;

import android.os.Bundle;
import android.view.View;
import android.view.WindowManager;
import android.webkit.WebSettings;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(NativePlayerPlugin.class);
        super.onCreate(savedInstanceState);

        // Keep screen awake while watching video
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        // Explicitly enable window hardware acceleration
        getWindow().setFlags(
            WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED,
            WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED
        );
    }

    @Override
    public void onStart() {
        super.onStart();
        if (getBridge() != null && getBridge().getWebView() != null) {
            View webView = getBridge().getWebView();
            webView.setLayerType(View.LAYER_TYPE_HARDWARE, null);
            WebSettings settings = getBridge().getWebView().getSettings();
            settings.setMediaPlaybackRequiresUserGesture(false);
        }
    }
}
