const sourceLabels: Record<string, string> = {
  booking: "Главная страница",
  "home:about": "Первый заезд",
  contacts: "Контакты",
  events: "Мероприятие в АвтоСим",
  "events:details": "Подбор формата мероприятия",
  faq: "FAQ",
  prices: "Страница цен",
  "prices:Standart": "Тариф Standart",
  "prices:Pro": "Тариф Pro",
  "prices:VR": "Тариф VR",
  "mode:circuit": "Режим: кольцевые гонки",
  "mode:drift": "Режим: дрифт",
  "mode:rally": "Режим: ралли",
  "mode:traffic": "Режим: шашки/трафик",
  "mode:truck": "Режим: дальнобойщики",
  "mode:open-world": "Режим: open world",
  "mode:vr": "Режим: VR",
  "mode:offroad": "Режим: бездорожье"
};

export function getSourceLabel(source: string) {
  return sourceLabels[source] ?? source;
}
