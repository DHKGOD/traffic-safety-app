package tw.edu.fju.trafficsafety;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

import tw.edu.fju.trafficsafety.guardian.GuardianPlugin;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(GuardianPlugin.class); // 本專案自寫的背景守護外掛（需在 super.onCreate 前註冊）
        super.onCreate(savedInstanceState);
    }
}
