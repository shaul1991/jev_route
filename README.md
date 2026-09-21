# jev_route

Oh My Pi(OMP)의 Jev router extension과 macOS 설치 도구입니다.

## 제공 기능

- 사용자 요청을 Jev의 `ALM role` / `work type` / `FAST|NORMAL|DEEP`로 분류해 OMP 모델 역할을 선택.
- routing decision, 적용 모델, audit 결과를 프로필별 JSONL로 기록.
- `/jev roles`, `/jev roles routes`, `/jev log [n]`으로 역할 경로와 기록을 확인.
- **observe-only Tool Risk Gate**: 위험 신호가 있는 `bash` 호출을 분류하지만 실행을 차단·수정·지연하지 않음.

Tool Risk Gate는 원문 command, 경로, 파일 내용, 인자값을 Jev에 전송하거나 로그에 남기지 않습니다. 로컬에서 만든 위험 신호와 명령 길이만 전송합니다. 시크릿 가능성이 있으면 Jev API 호출 없이 로컬 기록만 남깁니다.

## 설치

```bash
git clone https://github.com/shaul1991/jev_route.git
cd jev_route
./scripts/install.sh
```

명시적으로 OMP profile을 지정하려면:

```bash
./scripts/install.sh omp-media
```

## TypeSafe API key

API key는 Git·환경 파일에 저장하지 않습니다. launcher는 **`TYPESAFE_API_KEY` 환경변수 우선**,
없으면 macOS login Keychain의 `omp-typesafe` 항목을 읽습니다.

### SSH에서 저장 없이 실행

이미 현재 shell에 키를 입력했다면:

```bash
export TYPESAFE_API_KEY
~/.local/bin/omp-jev
```

새로 입력해야 한다면 macOS 기본 zsh에서 다음처럼 숨김 입력합니다.
키 자체를 명령에 적지 않아 shell history에 남기지 않습니다.

```zsh
read -rs 'TYPESAFE_API_KEY?TypeSafe API key: '
printf '\n'
export TYPESAFE_API_KEY
~/.local/bin/omp-jev
```

이 방식은 Keychain을 사용하지 않고 해당 shell과 자식 프로세스의 환경변수에만 키를 둡니다.
환경변수도 같은 사용자나 권한 있는 프로세스가 읽을 수 있으므로 공개 로그로 출력하지 마세요.

### Keychain에 영구 저장

`User interaction is not allowed`는 API key 인증 실패가 아니라 Keychain 접근 실패입니다.
GUI terminal에서도 login Keychain이 잠겨 있거나 접근 승인이 필요하면 발생할 수 있습니다.
먼저 **대상 Mac의 터미널에서 대화형으로** 잠금을 해제합니다(SSH는 `ssh -t m1`로 터미널 확보).

```bash
security unlock-keychain "$HOME/Library/Keychains/login.keychain-db"
```

프롬프트에는 **login Keychain 비밀번호**(보통 Mac 로그인 비밀번호)를 입력합니다.
TypeSafe API key가 아닙니다. 비밀번호를 `-p` 인자로 넣거나 이 저장소에 저장하지 마세요.
잠금 해제 후, 키를 stdin으로 전달합니다.

```bash
printf '%s' "$TYPESAFE_API_KEY" | ./scripts/store-key.sh
```

저장 스크립트는 API key를 `security`의 프로세스 인자가 아닌 stdin으로 전달하고,
저장 후 다시 읽어 일치하는지 확인합니다. Keychain 잠금이나 ACL이 계속 접근을 막으면
로컬 Keychain Access에서 상태를 확인하거나 위 환경변수 실행 방식을 사용하세요.
모든 프로그램에 접근을 허용하는 `-A` 옵션은 사용하지 않습니다.

## 실행

```bash
~/.local/bin/omp-jev
```

launcher는 환경변수 또는 Keychain에서 `TYPESAFE_API_KEY`를 읽고 다음 기본값을 설정합니다.

```text
JEV_ROUTER_MODE=active
JEV_TOOL_RISK_MODE=observe
```

다르게 실행하려면 환경 변수로 덮어쓸 수 있습니다.

```bash
JEV_ROUTER_MODE=observe ~/.local/bin/omp-jev
JEV_TOOL_RISK_MODE=off ~/.local/bin/omp-jev
```

## OMP 명령

```text
/jev roles          # Jev routing role과 실제 OMP 모델 배정 확인
/jev roles routes   # ALM 분류 → 역할 후보 순서 전체 보기
/jev log 20         # 요청, Jev 판단, 배정 모델 최근 20건
/jev risk           # observe-only bash 위험 관찰 최근 기록
```

## 로그

로그는 `PI_CODING_AGENT_DIR`를 우선 사용하므로 named profile끼리 섞이지 않습니다.

```text
<agent-dir>/jev-router.decisions.jsonl
<agent-dir>/jev-router.audits.jsonl
<agent-dir>/jev-tool-risk.audits.jsonl
<agent-dir>/jev-router.policies.json
```

기본 profile의 `<agent-dir>`은 `~/.omp/agent`입니다. `omp-media` 같은 named profile은 `~/.omp/profiles/<profile>/agent`입니다.
