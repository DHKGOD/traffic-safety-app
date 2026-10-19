"""路口體檢報告的「改善建議」：依主要肇因、事故型態與條件產生（規則式，可解釋）。"""
from __future__ import annotations

RULES: list[tuple[tuple[str, ...], str, str]] = [
    # (關鍵字, 給用路人的建議, 給道路管理單位的改善建議)
    (("轉彎車未讓直行車", "左轉彎未依規定", "右轉彎未依規定", "迴轉"),
     "轉彎前務必停看聽，特別留意對向直行機車與右側機車。",
     "評估設置左轉專用時相、轉彎提示標誌或機車兩段式左轉區。"),
    (("支線道未讓幹線道", "未依規定讓車", "無號誌路口"),
     "接近無號誌路口請減速，支線道車輛要停車再開。",
     "支線道加設「停」標誌與停止線，或評估設置閃光號誌。"),
    (("未保持行車安全距離", "未保持行車安全間隔"),
     "與前車保持安全距離，尖峰時段勿緊跟、勿鑽車縫。",
     "加強路段速度管理，評估劃設禁止變換車道線。"),
    (("恍神", "分心", "注意車前狀態"),
     "專心駕駛，接近路口時放下手機與導航操作。",
     "在路口前設置醒目警示標誌或減速標線。"),
    (("闖紅燈", "違反號誌", "違反特定標誌"),
     "依號誌通行，黃燈不搶快。",
     "檢討號誌時制與黃燈、全紅時間，評估設置科技執法。"),
    (("起步時未注意", "倒車"),
     "起步或倒車前回頭確認後方與側邊來車。",
     "檢討路邊停車格位置，避免影響車流。"),
    (("超速", "未依規定減速", "速度"),
     "接近路口請放慢車速。",
     "評估設置減速標線、跳動路面或區間測速。"),
    (("酒", "毒"),
     "酒後不開車。",
     "加強夜間酒駕攔檢。"),
    (("行人", "穿越"),
     "行人請走行人穿越道，過馬路前左右確認；駕駛人在斑馬線前要停讓行人。",
     "評估設置行人庇護島、行人早開時相或標線型人行道。"),
]

COLLISION_TIPS = {
    "路口交岔撞": "本路口常見「交岔撞」，表示兩方向車流互相衝突，通過時請特別減速。",
    "側撞": "常見「側撞」，留意轉彎與變換車道的車輛。",
    "追撞": "常見「追撞」，請保持安全距離並避免急煞。",
    "穿越道路中": "常見行人「穿越道路中」被撞，行人與駕駛都要特別小心。",
    "路上翻車、摔倒": "常見機車自摔，雨天路面濕滑時請放慢速度。",
}


def build_advice(top_causes: list[str], top_collisions: list[str], rain_ratio: float, night_ratio: float,
                 elderly_ratio: float) -> dict[str, list[str]]:
    road_user: list[str] = []
    authority: list[str] = []
    text = " ".join(top_causes)
    for keys, user_tip, gov_tip in RULES:
        if any(k in text for k in keys):
            if user_tip not in road_user:
                road_user.append(user_tip)
            if gov_tip not in authority:
                authority.append(gov_tip)
    for c in top_collisions:
        if c in COLLISION_TIPS:
            road_user.append(COLLISION_TIPS[c])
    if rain_ratio >= 0.2:
        road_user.append(f"雨天事故占 {rain_ratio:.0%}，下雨時請提早減速、加大跟車距離。")
        authority.append("檢查路面排水與標線抗滑係數。")
    if night_ratio >= 0.35:
        road_user.append(f"夜間事故占 {night_ratio:.0%}，晚上通過請放慢、穿著亮色衣物。")
        authority.append("檢查路口照明是否充足。")
    if elderly_ratio >= 0.15:
        road_user.append(f"65 歲以上當事人占 {elderly_ratio:.0%}，長輩通行請家人多提醒。")
    if not road_user:
        road_user.append("通過路口時減速、注意左右來車。")
    return {"road_user": road_user[:6], "authority": authority[:5]}
