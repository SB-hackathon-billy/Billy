"""Exercise the real app at 390px, capture center flows, and record HTTP methods.
Run with a Python environment containing Playwright. No API interception or mocks.
"""
import json
import os
import re
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

BASE = os.environ.get('CENTER_BASE_URL', 'http://127.0.0.1:5175')
ARTIFACTS = Path(__file__).resolve().parents[3] / 'test-artifacts' / 'center'
ARTIFACTS.mkdir(parents=True, exist_ok=True)
results = {'viewport': {'width': 390, 'height': 844}, 'screenshots': [], 'requests': [], 'errors': [], 'checks': []}

with sync_playwright() as p:
    launch = {}
    if os.environ.get('CENTER_BROWSER_EXECUTABLE'):
        launch['executable_path'] = os.environ['CENTER_BROWSER_EXECUTABLE']
    browser = p.chromium.launch(**launch)
    context = browser.new_context(viewport=results['viewport'], device_scale_factor=1, locale='ko-KR', timezone_id='Asia/Seoul', reduced_motion='reduce')
    page = context.new_page()
    page.on('pageerror', lambda error: results['errors'].append(str(error)))
    page.on('request', lambda request: results['requests'].append({'method': request.method, 'url': request.url}))
    page.set_default_timeout(15000)

    def visit(path):
        page.goto(BASE + path, wait_until='networkidle')
        expect(page.locator('.center-feature')).to_be_visible()

    def shot(name):
        assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth'), 'Horizontal overflow: ' + name
        if page.get_by_role('dialog').count() == 0:
            page.evaluate('window.scrollTo(0, 0)')
        page.screenshot(path=str(ARTIFACTS / (name + '.png')), full_page=page.get_by_role('dialog').count() == 0)
        results['screenshots'].append(name + '.png')

    def close_sheet():
        page.keyboard.press('Escape')
        expect(page.get_by_role('dialog')).not_to_be_visible()

    try:
        visit('/center')
        expect(page).to_have_url(re.compile('/center/about$'))
        shot('C01-intro')
        page.get_by_role('tab', name='이용안내', exact=True).click()
        shot('C01-guide')
        page.get_by_role('tab', name='오시는 길', exact=True).click()
        shot('C01-location')
        assert page.get_by_role('link', name='지도에서 길찾기').get_attribute('rel') == 'noopener noreferrer'
        results['checks'].append('C01 introduction, guide, location, official external links')

        visit('/center/business')
        shot('C02-list')
        page.get_by_role('button', name='심리 정서 지원', exact=True).click()
        expect(page.get_by_text('1개의 사업 예시', exact=True)).to_be_visible()
        shot('C02-category')
        page.get_by_role('button', name='전체 보기', exact=True).click()
        page.get_by_role('button', name='조건 필터', exact=True).click()
        page.get_by_label('모집 상태', exact=True).select_option(label='모집 예시')
        page.get_by_label('진행 요일', exact=True).select_option(label='수요일')
        shot('C02-filter-sheet')
        page.get_by_role('button', name='필터 적용', exact=True).click()
        expect(page.get_by_role('heading', name='동네 친구와 한 끼')).to_be_visible()
        shot('C02-filter-results')
        page.get_by_role('button', name='전체 보기', exact=True).click()
        page.get_by_role('tab', name='달력', exact=True).click()
        expect(page.get_by_role('heading', name='나를 돌보는 작은 습관')).to_be_visible()
        shot('C02-calendar')
        # Native React Aria keyboard selection moves to the next day.
        selected = page.locator('.center-calendar-cell[data-selected]')
        selected.focus()
        page.keyboard.press('ArrowRight')
        page.keyboard.press('Enter')
        expect(page.get_by_role('heading', name='아직 보여드릴 내용이 없어요')).to_be_visible()
        shot('C02-calendar-empty')
        page.get_by_role('button', name='조건 초기화', exact=True).click()
        page.get_by_role('searchbox', name='사업 검색').fill('작은 습관')
        shot('C02-search')
        page.get_by_role('heading', name='나를 돌보는 작은 습관').get_by_role('link').click()
        shot('C02-detail')
        results['checks'].append('C02 category, status/day filters, search, keyboard calendar, empty state, detail')

        visit('/center/programs')
        shot('C03-list')
        page.get_by_role('searchbox', name='프로그램 검색').fill('없는프로그램')
        expect(page.get_by_role('heading', name='아직 보여드릴 내용이 없어요')).to_be_visible()
        shot('C03-empty')
        page.get_by_role('button', name='조건 초기화', exact=True).click()
        page.get_by_role('searchbox', name='프로그램 검색').fill('작은 정원')
        shot('C03-search')
        page.get_by_role('heading', name='내 방의 작은 정원').get_by_role('link').click()
        page.locator('.center-interest').click()
        expect(page.locator('.center-interest')).to_have_attribute('aria-pressed', 'true')
        shot('C03-detail-interest')
        page.get_by_role('button', name='신청 양식 살펴보기', exact=True).click()
        shot('C03-form')
        page.get_by_role('textbox', name='예시 별명').fill('')
        page.get_by_role('button', name='신청 미리보기', exact=True).click()
        expect(page.get_by_role('alert')).to_contain_text('빈 항목')
        shot('C03-form-validation')
        page.get_by_role('textbox', name='예시 별명').fill('검토용 이웃')
        # IME composition Enter must not transition to preview.
        page.get_by_role('textbox', name='예시 별명').dispatch_event('keydown', {'key': 'Enter', 'isComposing': True})
        expect(page.get_by_role('heading', name='프로그램 신청 양식')).to_be_visible()
        page.get_by_role('button', name='신청 미리보기', exact=True).click()
        expect(page.get_by_text('검토용 이웃', exact=True)).to_be_visible()
        shot('C03-preview')
        close_sheet()
        page.get_by_role('button', name='신청 양식 살펴보기', exact=True).click()
        expect(page.get_by_role('textbox', name='예시 별명')).to_have_value('이웃')
        close_sheet()
        page.reload(wait_until='networkidle')
        expect(page.locator('.center-interest')).to_have_attribute('aria-pressed', 'false')
        results['checks'].append('C03 search, empty, interest, form validation, IME Enter, preview, close reset, reload reset')

        visit('/center/clubs')
        shot('C04-recruiting')
        page.get_by_role('searchbox', name='동아리 검색').fill('없는동아리')
        shot('C04-empty')
        page.get_by_role('button', name='조건 초기화', exact=True).click()
        page.get_by_role('tab', name='활동 이야기', exact=True).click()
        shot('C04-activities')
        page.get_by_role('heading', name='초록을 나누는 사이').get_by_role('link').click()
        shot('C04-detail')
        for kind, title, action in [('leader', '리더 참여 양식', '신청 미리보기'), ('member', '팀원 참여 양식', '신청 미리보기'), ('report', '활동보고 양식', '활동보고 미리보기')]:
            page.get_by_role('button', name=title, exact=True).click()
            shot('C04-' + kind + '-form')
            if page.locator('.center-sheet').evaluate('(el) => el.scrollHeight > el.clientHeight'):
                page.locator('.center-sheet').evaluate('(el) => el.scrollTop = el.scrollHeight')
                shot('C04-' + kind + '-form-bottom')
            page.get_by_role('button', name=action, exact=True).click()
            expect(page.get_by_role('heading', name='입력 내용을 확인해 보세요')).to_be_visible()
            shot('C04-' + kind + '-preview')
            close_sheet()
        results['checks'].append('C04 recruiting, activities, empty, leader/member/report forms and previews')

        visit('/center/spaces')
        shot('C05-list')
        page.get_by_role('searchbox', name='공간 검색').fill('없는공간')
        shot('C05-empty')
        page.get_by_role('button', name='조건 초기화', exact=True).click()
        page.get_by_role('heading', name='함께방', exact=True).get_by_role('link').click()
        shot('C05-detail-calendar')
        page.get_by_label('시작 시간', exact=True).select_option('14:00')
        page.get_by_label('종료 시간', exact=True).select_option('12:00')
        page.get_by_role('button', name='예약 미리보기', exact=True).click()
        expect(page.get_by_role('alert')).to_contain_text('종료 시간')
        shot('C05-invalid-time')
        page.get_by_label('종료 시간', exact=True).select_option('16:00')
        page.get_by_role('button', name='예약 미리보기', exact=True).click()
        expect(page.get_by_role('dialog')).to_contain_text('14:00–16:00')
        shot('C05-preview')
        close_sheet()
        results['checks'].append('C05 spaces, empty, date/time selection, invalid time, reservation preview')

        visit('/center/news')
        shot('C06-notices')
        page.get_by_role('searchbox', name='소식 제목 검색').fill('함께하는')
        shot('C06-search')
        page.get_by_role('searchbox', name='소식 제목 검색').fill('없는소식')
        shot('C06-empty')
        page.get_by_role('button', name='조건 초기화', exact=True).click()
        page.get_by_role('heading', name='센터 화면을 둘러보는 방법').get_by_role('link').click()
        shot('C06-notice-detail')
        visit('/center/news')
        page.get_by_role('tab', name='보도', exact=True).click()
        shot('C06-press')
        page.get_by_role('heading', name='이웃과 연결되는 일상의 공간').get_by_role('link').click()
        shot('C06-press-detail')
        visit('/center/news')
        page.get_by_role('tab', name='사진첩', exact=True).click()
        shot('C06-gallery-list')
        page.get_by_role('heading', name='초록을 나눈 하루').get_by_role('link').click()
        shot('C06-gallery-detail')
        page.get_by_role('button', name=re.compile('그림 1 크게 보기:')).click()
        shot('C06-gallery-viewer')
        page.get_by_role('button', name='다음 그림', exact=True).click()
        expect(page.get_by_role('heading', name='그림 2 / 2')).to_be_visible()
        shot('C06-gallery-next')
        close_sheet()
        results['checks'].append('C06 notice/press/gallery lists, search, empty, details, gallery paging')

        visit('/center/programs/not-a-content-id')
        expect(page.get_by_role('heading', name='콘텐츠를 찾을 수 없어요')).to_be_visible()
        shot('content-not-found')
        assert not results['errors'], results['errors']
        mutations = [request for request in results['requests'] if request['method'] not in ['GET', 'HEAD', 'OPTIONS']]
        assert not mutations, mutations
        assert page.evaluate('localStorage.length') == 0
        assert page.evaluate('sessionStorage.length') == 0
        results['checks'].append('No page errors, no horizontal overflow, no HTTP mutations, no local/session storage')
        results['outcome'] = 'passed'
        (ARTIFACTS / 'failure.png').unlink(missing_ok=True)
    except Exception as error:
        results['outcome'] = 'failed'
        results['failure'] = str(error)
        page.screenshot(path=str(ARTIFACTS / 'failure.png'), full_page=True)
        raise
    finally:
        results['mutationRequests'] = [request for request in results['requests'] if request['method'] not in ['GET', 'HEAD', 'OPTIONS']]
        (ARTIFACTS / 'browser-results.json').write_text(json.dumps(results, ensure_ascii=False, indent=2) + '\n')
        print(json.dumps({'outcome': results.get('outcome'), 'screenshots': len(results['screenshots']), 'checks': results['checks'], 'mutations': results['mutationRequests'], 'errors': results['errors']}, ensure_ascii=False, indent=2))
        browser.close()
