from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    BaseDocTemplate,
    Frame,
    PageBreak,
    NextPageTemplate,
    PageTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)


ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "output" / "pdf"
OUT_DIR.mkdir(parents=True, exist_ok=True)
PDF_PATH = OUT_DIR / "auto-sim-technical-proposal.pdf"

PAGE_W, PAGE_H = A4
MARGIN_X = 18 * mm
MARGIN_TOP = 18 * mm
MARGIN_BOTTOM = 16 * mm

NAVY = colors.HexColor("#111827")
INK = colors.HexColor("#1f2937")
MUTED = colors.HexColor("#6b7280")
LINE = colors.HexColor("#e5e7eb")
SOFT = colors.HexColor("#f3f4f6")
ACCENT = colors.HexColor("#ef4444")
GREEN = colors.HexColor("#16a34a")
BLUE = colors.HexColor("#2563eb")
AMBER = colors.HexColor("#f59e0b")
WHITE = colors.white


def register_fonts():
    font_dir = Path("/System/Library/Fonts/Supplemental")
    pdfmetrics.registerFont(TTFont("DocRegular", str(font_dir / "Arial.ttf")))
    pdfmetrics.registerFont(TTFont("DocBold", str(font_dir / "Arial Bold.ttf")))
    pdfmetrics.registerFont(TTFont("DocItalic", str(font_dir / "Arial Italic.ttf")))


def para(text, style):
    return Paragraph(text, style)


def keep(text):
    return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def cell(text, style):
    return para(keep(text), style)


def make_styles():
    base = getSampleStyleSheet()
    return {
        "cover_kicker": ParagraphStyle(
            "cover_kicker",
            parent=base["Normal"],
            fontName="DocBold",
            fontSize=10,
            leading=13,
            textColor=colors.HexColor("#c7d2fe"),
            alignment=TA_CENTER,
            uppercase=True,
        ),
        "cover_title": ParagraphStyle(
            "cover_title",
            parent=base["Normal"],
            fontName="DocBold",
            fontSize=28,
            leading=34,
            textColor=WHITE,
            alignment=TA_CENTER,
            spaceAfter=12,
        ),
        "cover_subtitle": ParagraphStyle(
            "cover_subtitle",
            parent=base["Normal"],
            fontName="DocRegular",
            fontSize=12,
            leading=18,
            textColor=colors.HexColor("#e5e7eb"),
            alignment=TA_CENTER,
        ),
        "h1": ParagraphStyle(
            "h1",
            parent=base["Heading1"],
            fontName="DocBold",
            fontSize=19,
            leading=24,
            textColor=NAVY,
            spaceBefore=4,
            spaceAfter=10,
        ),
        "h2": ParagraphStyle(
            "h2",
            parent=base["Heading2"],
            fontName="DocBold",
            fontSize=13,
            leading=17,
            textColor=NAVY,
            spaceBefore=9,
            spaceAfter=5,
        ),
        "body": ParagraphStyle(
            "body",
            parent=base["BodyText"],
            fontName="DocRegular",
            fontSize=9.8,
            leading=14.2,
            textColor=INK,
            spaceAfter=5,
        ),
        "small": ParagraphStyle(
            "small",
            parent=base["BodyText"],
            fontName="DocRegular",
            fontSize=8.2,
            leading=11.5,
            textColor=MUTED,
        ),
        "strong": ParagraphStyle(
            "strong",
            parent=base["BodyText"],
            fontName="DocBold",
            fontSize=9.4,
            leading=12.5,
            textColor=NAVY,
        ),
        "table_head": ParagraphStyle(
            "table_head",
            parent=base["BodyText"],
            fontName="DocBold",
            fontSize=8.4,
            leading=10.5,
            textColor=WHITE,
            alignment=TA_LEFT,
        ),
        "table": ParagraphStyle(
            "table",
            parent=base["BodyText"],
            fontName="DocRegular",
            fontSize=8.1,
            leading=10.5,
            textColor=INK,
        ),
        "table_bold": ParagraphStyle(
            "table_bold",
            parent=base["BodyText"],
            fontName="DocBold",
            fontSize=8.1,
            leading=10.5,
            textColor=NAVY,
        ),
        "metric": ParagraphStyle(
            "metric",
            parent=base["BodyText"],
            fontName="DocBold",
            fontSize=15,
            leading=18,
            textColor=NAVY,
            alignment=TA_CENTER,
        ),
        "metric_label": ParagraphStyle(
            "metric_label",
            parent=base["BodyText"],
            fontName="DocRegular",
            fontSize=7.7,
            leading=9.5,
            textColor=MUTED,
            alignment=TA_CENTER,
        ),
    }


class ProposalDoc(BaseDocTemplate):
    def __init__(self, filename):
        super().__init__(
            filename,
            pagesize=A4,
            leftMargin=MARGIN_X,
            rightMargin=MARGIN_X,
            topMargin=MARGIN_TOP,
            bottomMargin=MARGIN_BOTTOM,
        )
        frame = Frame(
            self.leftMargin,
            self.bottomMargin,
            self.width,
            self.height,
            id="normal",
        )
        self.addPageTemplates(
            [
                PageTemplate(id="cover", frames=[frame], onPage=draw_cover_bg),
                PageTemplate(id="body", frames=[frame], onPage=draw_footer),
            ]
        )


def draw_cover_bg(canvas, doc):
    canvas.saveState()
    canvas.setFillColor(NAVY)
    canvas.rect(0, 0, PAGE_W, PAGE_H, stroke=0, fill=1)
    canvas.setFillColor(colors.HexColor("#1f2937"))
    canvas.rect(0, 0, PAGE_W, 70 * mm, stroke=0, fill=1)
    canvas.setFillColor(ACCENT)
    canvas.rect(0, PAGE_H - 9 * mm, PAGE_W, 9 * mm, stroke=0, fill=1)
    canvas.setFillColor(colors.HexColor("#374151"))
    canvas.roundRect(24 * mm, 28 * mm, PAGE_W - 48 * mm, 26 * mm, 3 * mm, stroke=0, fill=1)
    canvas.setFont("DocRegular", 8)
    canvas.setFillColor(colors.HexColor("#d1d5db"))
    canvas.drawCentredString(PAGE_W / 2, 39 * mm, "Подготовлено как техническое заключение и основа для предложения по переработке сайта")
    canvas.restoreState()


def draw_footer(canvas, doc):
    canvas.saveState()
    canvas.setStrokeColor(LINE)
    canvas.line(MARGIN_X, 13 * mm, PAGE_W - MARGIN_X, 13 * mm)
    canvas.setFont("DocRegular", 7.5)
    canvas.setFillColor(MUTED)
    canvas.drawString(MARGIN_X, 8 * mm, "auto-sim.ru - технический аудит и предложение по переработке")
    canvas.drawRightString(PAGE_W - MARGIN_X, 8 * mm, f"стр. {doc.page}")
    canvas.restoreState()


def pill_table(items, styles):
    data = []
    row = []
    for label, value, color in items:
        row.append(
            [
                para(keep(value), styles["metric"]),
                para(keep(label), styles["metric_label"]),
            ]
        )
    data.append(row)
    table = Table(data, colWidths=[39 * mm] * len(items), hAlign="LEFT")
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), SOFT),
                ("BOX", (0, 0), (-1, -1), 0.5, LINE),
                ("INNERGRID", (0, 0), (-1, -1), 0.5, WHITE),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("TOPPADDING", (0, 0), (-1, -1), 7),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
            ]
        )
    )
    return table


def evidence_table(styles):
    rows = [
        ["Проверка", "Зафиксированный факт", "Бизнес-риск"],
        [
            "HTML главной",
            "Сервер отдает документ 524 байта: фактически только root-контейнер для React.",
            "Контент зависит от выполнения JavaScript. Это слабая база для SEO-лендинга.",
        ],
        [
            "robots.txt",
            "URL возвращает HTML главной страницы, Lighthouse отмечает 14 ошибок.",
            "Поисковые роботы не получают корректные инструкции и ссылку на sitemap.",
        ],
        [
            "sitemap.xml",
            "URL возвращает HTML приложения вместо XML-карты сайта.",
            "Сайт хуже раскрывает структуру, статьи и будущие посадочные страницы.",
        ],
        [
            "Метаданные",
            "Нет meta description, canonical и JSON-LD structured data.",
            "Снижается контроль сниппета, локальной релевантности и расширенных результатов.",
        ],
        [
            "Title",
            "В title указано 'Орнебурге' вместо 'Оренбурге'.",
            "Ошибка в ключевом локальном слове снижает доверие и качество выдачи.",
        ],
        [
            "Маршруты",
            "Служебные и несуществующие URL получают 200 OK и HTML главной.",
            "Поисковик может видеть технический мусор вместо нормальных страниц и 404.",
        ],
    ]
    data = [[cell(c, styles["table_head"]) for c in rows[0]]]
    for row in rows[1:]:
        data.append([cell(row[0], styles["table_bold"]), cell(row[1], styles["table"]), cell(row[2], styles["table"])])
    table = Table(data, colWidths=[31 * mm, 71 * mm, 72 * mm], repeatRows=1)
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), NAVY),
                ("BACKGROUND", (0, 1), (-1, -1), colors.white),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f9fafb")]),
                ("GRID", (0, 0), (-1, -1), 0.45, LINE),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 6),
                ("RIGHTPADDING", (0, 0), (-1, -1), 6),
                ("TOPPADDING", (0, 0), (-1, -1), 6),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
            ]
        )
    )
    return table


def plan_table(styles):
    rows = [
        ["Этап", "Содержание работ", "Результат для бизнеса"],
        [
            "1. Техническая основа",
            "Перенос на Next.js, SSR/SSG, корректные 404, robots.txt, sitemap.xml, canonical.",
            "Сайт получает нормальную индексируемую структуру вместо SPA-визитки.",
        ],
        [
            "2. SEO-структура",
            "Разделение контента на страницы: главная, цены, день рождения, корпоративы, FAQ, блог, privacy.",
            "Появляются посадочные страницы под разные поисковые намерения.",
        ],
        [
            "3. Семантика и доверие",
            "Meta title/description, JSON-LD LocalBusiness, Organization, FAQPage, BreadcrumbList.",
            "Поисковику проще понять бизнес, адрес, услуги, FAQ и контакты.",
        ],
        [
            "4. Производительность",
            "Оптимизация изображений, критический CSS, уменьшение лишнего JavaScript, lazy loading.",
            "Быстрее мобильная загрузка, выше конверсия с рекламы и органики.",
        ],
        [
            "5. Контент и аналитика",
            "Нормальные CTA, формы/события, микроразметка, подготовка блога и UTM/целей.",
            "Сайт становится управляемым инструментом продаж, а не статичной страницей.",
        ],
    ]
    data = [[cell(c, styles["table_head"]) for c in rows[0]]]
    for row in rows[1:]:
        data.append([cell(row[0], styles["table_bold"]), cell(row[1], styles["table"]), cell(row[2], styles["table"])])
    table = Table(data, colWidths=[37 * mm, 76 * mm, 61 * mm], repeatRows=1)
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), NAVY),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f9fafb")]),
                ("GRID", (0, 0), (-1, -1), 0.45, LINE),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 6),
                ("RIGHTPADDING", (0, 0), (-1, -1), 6),
                ("TOPPADDING", (0, 0), (-1, -1), 6),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
            ]
        )
    )
    return table


def priority_table(styles):
    rows = [
        ["Приоритет", "Что исправить", "Зачем"],
        ["Критично", "robots.txt, sitemap.xml, 404, title с ошибкой города", "Убрать явные технические дефекты и мусорную индексацию."],
        ["Высокий", "SSR/SSG на Next.js, meta description, canonical", "Сделать сайт понятным для поиска и соцсетей без зависимости от JS."],
        ["Высокий", "Структурированные данные LocalBusiness, FAQ, Organization", "Усилить локальное SEO и доверие к бизнесу."],
        ["Средний", "Разделить контент на страницы и статьи", "Собирать больше поисковых запросов, не только брендовых."],
        ["Средний", "Оптимизировать изображения и JS", "Ускорить мобильную загрузку и повысить конверсию."],
    ]
    data = [[cell(c, styles["table_head"]) for c in rows[0]]]
    for row in rows[1:]:
        data.append([cell(row[0], styles["table_bold"]), cell(row[1], styles["table"]), cell(row[2], styles["table"])])
    table = Table(data, colWidths=[30 * mm, 72 * mm, 72 * mm], repeatRows=1)
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), NAVY),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f9fafb")]),
                ("GRID", (0, 0), (-1, -1), 0.45, LINE),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 6),
                ("RIGHTPADDING", (0, 0), (-1, -1), 6),
                ("TOPPADDING", (0, 0), (-1, -1), 6),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
            ]
        )
    )
    return table


def build_story():
    register_fonts()
    styles = make_styles()
    story = []

    story.append(Spacer(1, 70 * mm))
    story.append(para("ТЕХНИЧЕСКОЕ ЗАКЛЮЧЕНИЕ", styles["cover_kicker"]))
    story.append(Spacer(1, 7 * mm))
    story.append(para("Аудит сайта auto-sim.ru<br/>и предложение по переработке", styles["cover_title"]))
    story.append(
        para(
            "Цель документа - зафиксировать технические ограничения текущего сайта и показать, почему точечные правки не решают проблему продвижения и роста.",
            styles["cover_subtitle"],
        )
    )
    story.append(Spacer(1, 52 * mm))
    story.append(para("Проверка выполнена: 25 июня 2026<br/>Формат: техническое заключение для принятия решения", styles["cover_subtitle"]))
    story.append(NextPageTemplate("body"))
    story.append(PageBreak())

    story.append(para("Резюме", styles["h1"]))
    story.append(
        para(
            "Текущий сайт auto-sim.ru реализован как одностраничное React-приложение. В браузере сайт визуально загружается, но на серверном уровне он отдает почти пустой HTML, а основной контент появляется только после загрузки JavaScript. Для локального коммерческого лендинга это слабая техническая основа: хуже контролируется индексация, метаданные, структура страниц, социальные превью и готовность к органическому продвижению.",
            styles["body"],
        )
    )
    story.append(
        para(
            "Вывод: сайт рациональнее не дорабатывать косметически, а пересобрать на Next.js с серверным рендером или статической генерацией, полноценной SEO-структурой, корректной серверной конфигурацией и подготовкой посадочных страниц под реальные поисковые запросы.",
            styles["body"],
        )
    )
    story.append(Spacer(1, 5 * mm))
    story.append(
        pill_table(
            [
                ("HTML главной страницы", "524 байта", ACCENT),
                ("Lighthouse Mobile SEO", "83/100", AMBER),
                ("Lighthouse Mobile Performance", "71/100", AMBER),
                ("LCP на mobile", "4.8 s", ACCENT),
            ],
            styles,
        )
    )
    story.append(Spacer(1, 7 * mm))
    story.append(para("Зафиксированные проблемы", styles["h1"]))
    story.append(evidence_table(styles))
    story.append(PageBreak())

    story.append(para("Почему это важно", styles["h1"]))
    story.append(para("1. Сайт выглядит нормально для человека, но технически слаб для поиска", styles["h2"]))
    story.append(
        para(
            "Серверная версия страницы почти пустая. Поисковику, мессенджеру, соцсети или AI-парсеру сначала отдается контейнер приложения, а не готовая страница с текстом, оффером, ценами, FAQ и контактами. Это особенно критично для локального бизнеса, где сайт должен стабильно отвечать на запросы 'автосимулятор Оренбург', 'гонки на симуляторе', 'день рождения в автосимуляторе' и похожие.",
            styles["body"],
        )
    )
    story.append(para("2. Базовая SEO-инфраструктура отсутствует или настроена неверно", styles["h2"]))
    story.append(
        para(
            "robots.txt и sitemap.xml возвращают HTML приложения. Это не вопрос вкуса или дизайна, а базовая техническая ошибка. Сайт не сообщает поисковикам карту страниц, правила сканирования и структуру будущего контента.",
            styles["body"],
        )
    )
    story.append(para("3. Один URL не заменяет нормальную структуру сайта", styles["h2"]))
    story.append(
        para(
            "На странице есть цены, FAQ, статьи, отзывы и предложения для мероприятий, но технически это собрано внутри одного SPA. Такой подход ограничивает продвижение: нельзя полноценно развивать статьи, отдельные услуги, страницы под корпоративы, дни рождения, VR, подарочные сертификаты и другие коммерческие сценарии.",
            styles["body"],
        )
    )
    story.append(para("4. Текущая архитектура тормозит развитие", styles["h2"]))
    story.append(
        para(
            "Если оставить сайт как есть, каждая следующая SEO-задача будет упираться в архитектуру: метаданные, карта сайта, отдельные страницы, микроразметка, 404, скорость загрузки, аналитика событий. Поэтому точечные исправления дадут ограниченный эффект.",
            styles["body"],
        )
    )
    story.append(Spacer(1, 4 * mm))
    story.append(para("Приоритеты исправлений", styles["h1"]))
    story.append(priority_table(styles))
    story.append(PageBreak())

    story.append(para("Предлагаемое решение", styles["h1"]))
    story.append(
        para(
            "Рекомендуемая стратегия - не косметический ремонт текущего SPA, а техническая переработка на Next.js. Это позволит отдавать поисковикам и пользователям готовый HTML, разделить контент на индексируемые страницы, подключить корректные метаданные и сохранить современный интерфейс без потери скорости.",
            styles["body"],
        )
    )
    story.append(plan_table(styles))
    story.append(Spacer(1, 7 * mm))
    story.append(para("Ожидаемый результат", styles["h1"]))
    outcome_rows = [
        ["Направление", "Что изменится после переработки"],
        ["SEO", "Контент будет доступен в HTML, появятся sitemap, robots, canonical, meta description и schema.org."],
        ["Локальное продвижение", "Сайт будет явно описывать бизнес, город, адрес, контакты, FAQ и услуги через структуру страниц и JSON-LD."],
        ["Конверсия", "Страницы можно будет точнее привязать к сценариям: первый визит, день рождения, корпоратив, абонемент, подарок."],
        ["Скорость", "Меньше лишнего JavaScript на первом экране, оптимизированные изображения, лучше мобильный опыт."],
        ["Масштабирование", "Можно развивать блог, акции, отдельные посадочные страницы и аналитику без переделки фундамента."],
    ]
    data = [[cell(c, styles["table_head"]) for c in outcome_rows[0]]]
    for row in outcome_rows[1:]:
        data.append([cell(row[0], styles["table_bold"]), cell(row[1], styles["table"])])
    table = Table(data, colWidths=[45 * mm, 129 * mm], repeatRows=1)
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), NAVY),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f9fafb")]),
                ("GRID", (0, 0), (-1, -1), 0.45, LINE),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 6),
                ("RIGHTPADDING", (0, 0), (-1, -1), 6),
                ("TOPPADDING", (0, 0), (-1, -1), 6),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
            ]
        )
    )
    story.append(table)
    story.append(Spacer(1, 7 * mm))
    story.append(para("Итоговое заключение", styles["h1"]))
    story.append(
        para(
            "Текущий сайт выполняет роль визуальной презентации, но не является качественной технической платформой для SEO и дальнейшего роста. Обнаруженные проблемы - не единичные недочеты, а следствие выбранной архитектуры: React SPA без серверного рендера и без полноценной SEO-конфигурации.",
            styles["body"],
        )
    )
    story.append(
        para(
            "Поэтому оптимальное решение - переработать сайт на Next.js и сразу заложить правильную структуру: серверный HTML, страницы под услуги, корректные служебные файлы, schema.org, метаданные, 404, оптимизацию изображений и аналитику. Это даст заказчику не просто обновленный внешний вид, а рабочий инструмент для рекламы, органического поиска и продаж.",
            styles["body"],
        )
    )
    story.append(Spacer(1, 5 * mm))
    story.append(
        Table(
            [[para("Рекомендация: принять решение о полной технической переработке сайта вместо набора точечных SEO-правок.", styles["strong"])]],
            colWidths=[174 * mm],
            style=TableStyle(
                [
                    ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#fff7ed")),
                    ("BOX", (0, 0), (-1, -1), 0.8, colors.HexColor("#fed7aa")),
                    ("LEFTPADDING", (0, 0), (-1, -1), 8),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 8),
                    ("TOPPADDING", (0, 0), (-1, -1), 8),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
                ]
            ),
        )
    )
    story.append(Spacer(1, 9 * mm))
    story.append(para("Предлагаемый формат проекта", styles["h1"]))
    project_rows = [
        ["Блок", "Содержание"],
        [
            "Проектирование",
            "Зафиксировать структуру страниц, сценарии бронирования, коммерческие офферы, SEO-ядро и требования к аналитике.",
        ],
        [
            "Дизайн и UX",
            "Собрать современный интерфейс без перегруза: первый экран, цены, мероприятия, FAQ, отзывы, контакты, мобильные состояния.",
        ],
        [
            "Разработка",
            "Реализовать сайт на Next.js с серверным HTML, корректной маршрутизацией, sitemap, robots, 404, schema.org и оптимизацией изображений.",
        ],
        [
            "Запуск",
            "Проверить индексацию, Lighthouse, базовые события аналитики, формы/CTA, корректность метаданных и технические URL.",
        ],
    ]
    data = [[cell(c, styles["table_head"]) for c in project_rows[0]]]
    for row in project_rows[1:]:
        data.append([cell(row[0], styles["table_bold"]), cell(row[1], styles["table"])])
    story.append(
        Table(
            data,
            colWidths=[42 * mm, 132 * mm],
            repeatRows=1,
            style=TableStyle(
                [
                    ("BACKGROUND", (0, 0), (-1, 0), NAVY),
                    ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f9fafb")]),
                    ("GRID", (0, 0), (-1, -1), 0.45, LINE),
                    ("VALIGN", (0, 0), (-1, -1), "TOP"),
                    ("LEFTPADDING", (0, 0), (-1, -1), 6),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 6),
                    ("TOPPADDING", (0, 0), (-1, -1), 6),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
                ]
            ),
        )
    )
    story.append(Spacer(1, 7 * mm))
    story.append(
        para(
            "Перед началом работ желательно согласовать целевые запросы, список услуг, правила бронирования, рекламные каналы и желаемую структуру контента. Это позволит делать сайт не как набор экранов, а как управляемую систему привлечения заявок.",
            styles["body"],
        )
    )
    story.append(Spacer(1, 6 * mm))
    story.append(para("Основание проверки", styles["h1"]))
    story.append(
        para(
            "Проверка проводилась по открытой версии сайта: браузерный просмотр, анализ серверного HTML и HTTP-ответов, проверка служебных URL, DOM после рендера, ассетов и локальный Lighthouse-аудит. Данные фиксируют состояние сайта на дату проверки и могут измениться после обновлений на сервере.",
            styles["small"],
        )
    )
    return story


def main():
    doc = ProposalDoc(str(PDF_PATH))
    story = build_story()
    doc.build(story)
    print(PDF_PATH)


if __name__ == "__main__":
    main()
