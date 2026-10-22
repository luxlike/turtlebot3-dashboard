// walle_arm 명령 목록 + 시뮬레이터용 대략적인 키프레임 (joint1..4 [rad], gripper [m])
// 실제 로봇에서는 walle_arm/gestures.py 의 값이 쓰이고, 여기 값은 화면 미리보기용입니다.

export const JOINT_NAMES = ["joint1", "joint2", "joint3", "joint4", "gripper", "gripper_sub"];

const HOME = [0, -1.0, 0.3, 0.7, 0.01];
const STOW = [0, -1.6, 1.35, 0.9, -0.005];

export const GESTURES: Record<string, number[][]> = {
  home: [HOME],
  stow: [STOW],
  wave: [
    [0, -0.4, -0.9, -0.3, 0.019],
    [0.45, -0.4, -0.9, -0.7, 0.019],
    [-0.45, -0.4, -0.9, 0.1, 0.019],
    [0.45, -0.4, -0.9, -0.7, 0.019],
    [-0.45, -0.4, -0.9, 0.1, 0.019],
    HOME,
  ],
  clap: [
    [0, -0.5, -0.2, 0.2, 0.019],
    [0, -0.5, -0.2, 0.2, -0.01],
    [0, -0.5, -0.2, 0.2, 0.019],
    [0, -0.5, -0.2, 0.2, -0.01],
    [0, -0.5, -0.2, 0.2, 0.019],
    HOME,
  ],
  curious: [
    [0.3, -0.2, -0.3, 0.5, 0.01],
    [0.3, 0.1, -0.4, 0.9, 0.01],
    [-0.2, 0.1, -0.4, 0.4, 0.01],
    HOME,
  ],
  shy: [STOW, [0.6, -1.6, 1.35, 1.2, -0.005], [0.6, -1.6, 1.35, 1.2, -0.005], STOW],
  reach_out: [[0, 0.5, -0.35, -0.1, 0.019]],
  pick: [
    [0, 0.2, 0.1, 1.2, 0.019],
    [0, 0.55, 0.15, 0.9, 0.019],
    [0, 0.55, 0.15, 0.9, -0.005],
    [0, -0.2, 0.0, 1.0, -0.005],
    STOW,
  ],
};

export const ARM_COMMANDS: { id: string; label: string; hint: string }[] = [
  { id: "home", label: "홈", hint: "기본 자세" },
  { id: "wave", label: "손 흔들기", hint: "wave" },
  { id: "clap", label: "박수", hint: "clap" },
  { id: "curious", label: "호기심", hint: "curious" },
  { id: "shy", label: "수줍음", hint: "shy" },
  { id: "reach_out", label: "손 내밀기", hint: "reach_out" },
  { id: "stow", label: "몸 접기", hint: "stow" },
  { id: "open", label: "그리퍼 열기", hint: "open" },
  { id: "close", label: "그리퍼 닫기", hint: "close" },
];

export const DRIVE_MODES: { id: string; label: string; hint: string }[] = [
  { id: "idle", label: "정지", hint: "cmd_vel 발행 중단" },
  { id: "ball", label: "공 추종", hint: "빨간 공 따라가기" },
  { id: "line", label: "라인", hint: "테이프 한 줄" },
  { id: "lane", label: "차선", hint: "양쪽 경계선 사이" },
  { id: "avoid", label: "회피", hint: "바닥색 기반 장애물 회피" },
];
