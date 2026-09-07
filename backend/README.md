# Google Apps Script 백엔드 배포

이 백엔드는 GitHub Pages 화면에 공용 로그인과 저장소를 제공합니다. 기존 `workstudent-manager`의 Apps Script 프로젝트나 URL은 사용하지 않습니다.

1. 새 Apps Script 프로젝트에 `Code.gs` 내용을 붙여넣습니다.
2. 프로젝트 설정의 **스크립트 속성**에 `INITIAL_ADMIN_PASSWORD`를 추가합니다.
3. 편집기에서 `initialize()`를 한 번 실행합니다.
4. **배포 → 새 배포 → 웹 앱**에서 실행 사용자는 본인, 액세스 권한은 모든 사용자로 배포합니다.
5. 생성된 `/exec` URL을 `config.js`의 `API_URL`에 넣습니다.

초기 관리자 아이디는 `admin`입니다. 초기 비밀번호는 스크립트 속성 값이며, 첫 로그인 후 계정 관리에서 변경합니다.
