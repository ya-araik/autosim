export const siteUrl = "https://auto-sim.ru";

export const business = {
  name: "АвтоСим",
  legalName: "АвтоСим - клуб автосимуляторов в Оренбурге",
  phone: "+7 (951) 030-88-56",
  phoneHref: "tel:+79510308856",
  city: "Оренбург",
  address: "Оренбург, ул. Рыбаковская, 59",
  streetAddress: "ул. Рыбаковская, 59",
  openingHours: "Ежедневно с 14:00 до 02:00",
  mapUrl:
    "https://yandex.ru/maps/?ll=55.104252%2C51.775331&mode=whatshere&whatshere%5Bpoint%5D=55.104252%2C51.775331&whatshere%5Bzoom%5D=17&z=17",
  mapWidgetUrl:
    "https://yandex.ru/map-widget/v1/?ll=55.104252%2C51.775331&pt=55.104252%2C51.775331%2Cpm2rdm&z=17",
  twoGisUrl:
    "https://2gis.ru/orenburg/search/%D0%A0%D1%8B%D0%B1%D0%B0%D0%BA%D0%BE%D0%B2%D1%81%D0%BA%D0%B0%D1%8F%2059?m=55.104252%2C51.775331%2F17",
  latitude: 51.775331418433325,
  longitude: 55.104252290539925
};

export const navItems = [
  { label: "О клубе", href: "/#about" },
  { label: "Режимы", href: "/#modes" },
  { label: "Цены", href: "/prices" },
  { label: "FAQ", href: "/faq" },
  { label: "Контакты", href: "/#contacts" }
] as const;

export const externalLinks = {
  googlePlay: "https://play.google.com/store/apps/details?id=com.smartgamer.app&hl=ru",
  appStore: "https://apps.apple.com/us/app/smartgamer/id6482296507",
  ruStore: "https://www.rustore.ru/catalog/app/com.smartgamer.app",
  instagram: "https://www.instagram.com/autosimx?igsh=MXNqbjZsMGZmdjFhZQ==",
  vk: "https://vk.com/autosimx",
  telegram: "https://t.me/autosimx"
};

export type Mode = {
  title: string;
  slug: string;
  image: string;
  alt: string;
  description: string;
};

export const modes: Mode[] = [
  {
    title: "Кольцевые гонки",
    slug: "ring",
    image: "/assets/optimized/f1.webp",
    alt: "Кольцевые гонки на автосимуляторе",
    description: "Трассы, апексы, борьба за десятые секунды и честное ощущение гоночного темпа."
  },
  {
    title: "Дрифт",
    slug: "drift",
    image: "/assets/optimized/drift.webp",
    alt: "Дрифт на автосимуляторе",
    description: "Контроль заноса, дым, контрруление и заезды, где важна не только скорость."
  },
  {
    title: "Ралли",
    slug: "rally",
    image: "/assets/optimized/rali.webp",
    alt: "Ралли на автосимуляторе",
    description: "Грунт, асфальт, снег, штурманские подсказки и постоянная работа с машиной."
  },
  {
    title: "Шашки / трафик",
    slug: "traffic",
    image: "/assets/optimized/trafic.webp",
    alt: "Езда в трафике на автосимуляторе",
    description: "Городской ритм, плотный поток и динамичные заезды для компании."
  },
  {
    title: "Дальнобойщики",
    slug: "truck",
    image: "/assets/optimized/Truck.webp",
    alt: "Симулятор дальнобойщика",
    description: "Длинные маршруты, грузовики, дороги и спокойная атмосфера путешествия."
  },
  {
    title: "Open world",
    slug: "open-world",
    image: "/assets/optimized/open.webp",
    alt: "Open world режим на автосимуляторе",
    description: "Свободная езда, город, трассы и возможность выбрать свой темп."
  },
  {
    title: "VR от первого лица",
    slug: "vr",
    image: "/assets/optimized/vr_first_person.webp",
    alt: "VR автосимулятор от первого лица",
    description: "Погружение в кокпит, когда поворот головы меняет все ощущение гонки."
  },
  {
    title: "Бездорожье",
    slug: "offroad",
    image: "/assets/optimized/offroad.webp",
    alt: "Бездорожье на автосимуляторе",
    description: "Грязь, камни, подъемы, аккуратная тяга и испытание терпения."
  }
];

export type PriceItem = {
  label: string;
  value: string;
  note?: string;
};

export type PricePlan = {
  title: string;
  subtitle: string;
  items: PriceItem[];
};

export const pricePlans: PricePlan[] = [
  {
    title: "Standart",
    subtitle: "Moza R5, 4K телевизоры 55″",
    items: [
      { label: "30 минут", value: "350 ₽" },
      { label: "1 час", value: "650 ₽" },
      { label: "1.5 часа", value: "900 ₽" },
      { label: "2 часа", value: "1150 ₽" },
      { label: "3 часа", value: "1550 ₽" },
      { label: "Абонемент на 5 часов", value: "2500 ₽" },
      { label: "Абонемент на 10 часов", value: "4400 ₽", note: "440 ₽/час" }
    ]
  },
  {
    title: "Pro",
    subtitle: "Moza R12, ultrawide мониторы 49″",
    items: [
      { label: "30 минут", value: "500 ₽" },
      { label: "1 час", value: "800 ₽" },
      { label: "1.5 часа", value: "1200 ₽" },
      { label: "2 часа", value: "1500 ₽" },
      { label: "3 часа", value: "2100 ₽" },
      { label: "Абонемент на 5 часов", value: "3300 ₽" },
      { label: "Абонемент на 10 часов", value: "5800 ₽", note: "580 ₽/час" }
    ]
  },
  {
    title: "VR-очки",
    subtitle: "Аренда VR для полного погружения",
    items: [
      { label: "30 минут", value: "400 ₽" },
      { label: "1 час", value: "500 ₽" }
    ]
  }
];

export const features = [
  {
    number: "01",
    title: "Топ-железо",
    text: "Симуляторы собраны на профессиональных комплектующих мировых брендов. Это не игрушки, а гоночная техника."
  },
  {
    number: "02",
    title: "Реалистичная физика",
    text: "Настройки, обратная связь и посадка помогают почувствовать автомобиль, трассу и работу педалей."
  },
  {
    number: "03",
    title: "Игра с друзьями",
    text: "Можно гонять по сети, устраивать заезды компанией и выбирать формат под настроение."
  },
  {
    number: "04",
    title: "Полное погружение",
    text: "Ультраширокие мониторы, VR и правильная посадка создают эффект настоящего кокпита."
  }
];

export const eventBenefits = [
  {
    title: "Весело и вовлеченно",
    text: "Участники не сидят в стороне: гонки быстро включают даже тех, кто раньше не играл."
  },
  {
    title: "Безопасно",
    text: "Адреналин есть, риска для настоящей машины и дороги нет."
  },
  {
    title: "Большой выбор",
    text: "Можно подобрать дисциплины под детей, взрослых, новичков и опытных игроков."
  },
  {
    title: "Необычный формат",
    text: "Это не стандартный банкет, а событие с эмоциями, соревнованием и фотографиями."
  }
];

export const faqItems = [
  {
    question: "Можно ли прийти с друзьями и гонять вместе?",
    answer: "Да. У нас можно играть по сети друг с другом до 6 человек. Для компании лучше бронировать время заранее."
  },
  {
    question: "Какие игры доступны?",
    answer: "Assetto Corsa, Competizione, Dirt Rally, City Car Driving, Euro Truck 2, Wreckfest, BeamNG.drive и другие симуляторы."
  },
  {
    question: "Есть ли ограничения по возрасту?",
    answer: "Доступ на симуляторы обычно с 14 лет. Ограничение связано с посадкой, настройками оборудования и безопасностью."
  },
  {
    question: "Я только учусь водить, можно ли потренироваться?",
    answer: "Да. Симулятор не заменяет автошколу, но помогает привыкнуть к педалям, рулю, парковке, реакции и базовым дорожным ситуациям."
  },
  {
    question: "Нужно ли уметь водить?",
    answer: "Нет. Администратор поможет выбрать режим, настроить посадку и объяснит управление перед заездом."
  },
  {
    question: "Можно организовать день рождения или корпоратив?",
    answer: "Да. Мы подберем формат, длительность и режимы под возраст, количество гостей и желаемую атмосферу."
  },
  {
    question: "Нужно ли бронировать время заранее?",
    answer: "Для компании, вечера и выходных лучше бронировать заранее. Так администратор закрепит нужное время и поможет выбрать подходящие симуляторы."
  },
  {
    question: "Сколько человек может прийти одновременно?",
    answer: "Формат зависит от свободных симуляторов и сценария визита. Для компании можно подобрать сетевые заезды, мини-турнир или очередность заездов."
  },
  {
    question: "Можно ли купить абонемент или подарить заезд?",
    answer: "Да. Доступны абонементы на несколько часов, а формат подарочного визита лучше уточнить у администратора перед бронированием."
  }
];

export const reviews = [
  {
    source: "Яндекс Карты",
    rating: "5,0",
    text: "Гости отмечают атмосферу клуба, оборудование и помощь администраторов."
  },
  {
    source: "2ГИС",
    rating: "5,0",
    text: "Формат подходит для компании, праздника и первого знакомства с автосимуляторами."
  }
];

export const galleryImages = [
  { src: "/assets/optimized/IND04559.webp", alt: "Игровая зона клуба АвтоСим" },
  { src: "/assets/optimized/IND04578.webp", alt: "Автосимуляторы в клубе АвтоСим" },
  { src: "/assets/optimized/IND04619.webp", alt: "Атмосфера клуба автосимуляторов" },
  { src: "/assets/optimized/IND04628.webp", alt: "Гоночное оборудование АвтоСим" }
];

export function absoluteUrl(path: string) {
  return `${siteUrl}${path}`;
}
