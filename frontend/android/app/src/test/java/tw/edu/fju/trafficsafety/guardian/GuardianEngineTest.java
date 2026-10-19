package tw.edu.fju.trafficsafety.guardian;

import static org.junit.Assert.*;

import java.util.Arrays;
import org.junit.Before;
import org.junit.Test;

/** 守護模式判斷邏輯的單元測試（gradlew testDebugUnitTest）。 */
public class GuardianEngineTest {
    private GuardianEngine e;
    // 測試路口：中正路 / 思源路附近
    private static final double HLAT = 25.0400, HLON = 121.4500;
    private static final double M = 1.0 / 111_000; // 約 1 公尺的緯度

    @Before
    public void setUp() {
        e = new GuardianEngine();
        e.setHotspots(Arrays.asList(new GuardianEngine.Hotspot(1, "中正路 / 思源路", HLAT, HLON, "high", 25)));
    }

    @Test
    public void walkingTowardHotspotAlertsOnceWithinRadius() {
        long t = 0;
        assertNull(e.onLocation(HLAT - 200 * M, HLON, 1.2, t += 1000)); // 200 m 外：不提醒
        assertNull(e.onLocation(HLAT - 100 * M, HLON, 1.2, t += 1000)); // 100 m：還在範圍外
        GuardianEngine.Alert a = e.onLocation(HLAT - 50 * M, HLON, 1.2, t += 1000); // 50 m：提醒
        assertNotNull(a);
        assertEquals(1, a.hotspot.id);
        assertEquals("foot", a.mode);
        assertEquals(50, a.distance, 2);
        assertNull(e.onLocation(HLAT - 30 * M, HLON, 1.2, t += 1000)); // 冷卻中：不重複
    }

    @Test
    public void movingAwayDoesNotAlert() {
        long t = 0;
        assertNotNull(e.onLocation(HLAT + 30 * M, HLON, 1.2, t += 1000));            // 一開啟就在範圍內：提醒一次
        assertNull(e.onLocation(HLAT + 40 * M, HLON, 1.2, t += 20 * 60 * 1000));     // 冷卻過後，但正在遠離
        assertNull(e.onLocation(HLAT + 50 * M, HLON, 1.2, t += 1000));
    }

    @Test
    public void carAlertsEarlierThanWalking() {
        long t = 0;
        assertNull(e.onLocation(HLAT - 400 * M, HLON, 15, t += 1000));
        GuardianEngine.Alert a = e.onLocation(HLAT - 200 * M, HLON, 15, t += 1000);
        assertNotNull(a);
        assertEquals("car", a.mode);
    }

    @Test
    public void transitModeIsSilent() {
        e.setUserMode("transit");
        assertNull(e.onLocation(HLAT - 50 * M, HLON, 10, 1000));
        assertNull(e.onLocation(HLAT - 10 * M, HLON, 10, 2000));
    }

    @Test
    public void cooldownExpiresAfterTenMinutes() {
        long t = 1000;
        assertNotNull(e.onLocation(HLAT - 50 * M, HLON, 1, t));
        e.onLocation(HLAT - 300 * M, HLON, 1, t += 60_000);           // 走遠
        assertNull(e.onLocation(HLAT - 50 * M, HLON, 1, t += 60_000)); // 5 分內回來：不提醒
        e.onLocation(HLAT - 300 * M, HLON, 1, t += 60_000);
        assertNotNull(e.onLocation(HLAT - 50 * M, HLON, 1, t += GuardianEngine.COOLDOWN_MS));
    }

    @Test
    public void autoModeBySpeed() {
        assertEquals("foot", e.effectiveMode(1.3));
        assertEquals("bike", e.effectiveMode(5));
        assertEquals("car", e.effectiveMode(13));
        e.setUserMode("bike");
        assertEquals("bike", e.effectiveMode(13));
    }
}
