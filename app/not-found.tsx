import Link from "next/link";

export default function NotFound() {
  return (
    <main className="not-found section">
      <div className="container not-found__inner">
        <p className="section-label">404</p>
        <h1>Такой страницы нет</h1>
        <p>
          Возможно, ссылка устарела. Вернитесь на главную или откройте раздел с
          ценами и бронированием.
        </p>
        <div className="button-row">
          <Link className="btn btn-primary" href="/">
            На главную
          </Link>
          <Link className="btn btn-secondary" href="/prices">
            Смотреть цены
          </Link>
        </div>
      </div>
    </main>
  );
}
