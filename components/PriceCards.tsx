import { LeadButton } from "@/components/LeadButton";
import { pricePlans } from "@/lib/site";

export function PriceCards({ compact = false }: { compact?: boolean }) {
  if (compact) {
    return (
      <div className="price-summary-grid">
        {pricePlans.map((plan) => {
          const hour = plan.items.find((item) => item.label === "1 час");
          const subscription = plan.items.find((item) =>
            item.label.includes("Абонемент на 10 часов")
          );

          return (
            <article className="price-summary-card" key={plan.title}>
              <div>
                <h3>{plan.title}</h3>
                <p>{plan.subtitle}</p>
              </div>
              <div className="price-summary-card__price">
                <span>{hour?.label ?? plan.items[0]?.label}</span>
                <strong>{hour?.value ?? plan.items[0]?.value}</strong>
              </div>
              {subscription ? (
                <p className="price-summary-card__note">
                  Абонемент 10 часов: {subscription.value}
                  {subscription.note ? `, ${subscription.note}` : ""}
                </p>
              ) : null}
              <LeadButton
                className="btn btn-primary btn-wide"
                modalTitle={`Бронирование: ${plan.title}`}
                modalContext={`Тариф ${plan.title}`}
                modalDescription={`Вы выбрали тариф ${plan.title}: ${plan.subtitle}. Оставьте контакты и удобное время, администратор поможет с бронью.`}
                messagePlaceholder={`Например: хочу ${plan.title} на 1 час в пятницу вечером, нас будет 2 человека`}
                source={`prices:${plan.title}`}
              >
                Забронировать
              </LeadButton>
            </article>
          );
        })}
      </div>
    );
  }

  const plans = pricePlans;

  return (
    <div className="price-grid">
      {plans.map((plan) => (
        <article className="price-card" key={plan.title}>
          <div>
            <h3>{plan.title}</h3>
            <p>{plan.subtitle}</p>
          </div>
          <ul>
            {plan.items.map((item) => (
              <li key={`${plan.title}-${item.label}`}>
                <span>
                  {item.label}
                  {item.note ? <small>{item.note}</small> : null}
                </span>
                <strong>{item.value}</strong>
              </li>
            ))}
          </ul>
          <LeadButton
            className="btn btn-primary btn-wide"
            modalTitle={`Бронирование: ${plan.title}`}
            modalContext={`Тариф ${plan.title}`}
            modalDescription={`Вы выбрали тариф ${plan.title}: ${plan.subtitle}. Оставьте контакты и удобное время, администратор поможет с бронью.`}
            messagePlaceholder={`Например: хочу ${plan.title} на 1 час в пятницу вечером, нас будет 2 человека`}
            source={`prices:${plan.title}`}
          >
            Забронировать
          </LeadButton>
        </article>
      ))}
    </div>
  );
}
