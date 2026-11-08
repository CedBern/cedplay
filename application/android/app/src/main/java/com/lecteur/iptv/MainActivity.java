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

        // Écran allumé pendant la session : le lecteur web (balise <video> dans cette
        // activité, accessible par le bouton « Lecteur ») n'a pas d'autre moyen de le
        // demander. Les activités de lecture native posent déjà leur propre drapeau.
        // Conséquence assumée : l'écran ne s'éteint pas non plus dans les menus.
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
