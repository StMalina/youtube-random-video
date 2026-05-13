# YouTube Random Video Button

Tampermonkey-userscript. На странице любого канала YouTube добавляет в ряд табов кнопку **🎲 Случайное**. По клику собирает все видео канала через внутренний YouTube API (innertube) и переходит на случайное.

## Установка

1. Установи расширение [Tampermonkey](https://www.tampermonkey.net/) (Chrome/Firefox/Edge).
2. Открой панель Tampermonkey → **Create a new script**.
3. Вставь содержимое `youtube-random-video.user.js`, сохрани (Ctrl+S).
4. Открой страницу любого канала, например `https://www.youtube.com/@veritasium`. В ряду табов появится **🎲 Случайное**.

## Как работает

- Слушает SPA-навигацию YouTube (`yt-navigate-finish`), на странице канала инжектит кнопку-таб.
- При клике берёт `channelId` из `ytInitialData`, конвертирует `UCxxx → UUxxx` (плейлист "Uploads").
- Делает `POST /youtubei/v1/browse` с `INNERTUBE_API_KEY`/`INNERTUBE_CONTEXT` из `ytcfg`. Пагинирует по `continuation`-токенам пока не соберёт все видео.
- Кэширует список в `sessionStorage` на 10 минут — повторный клик мгновенный.
- Для редких случаев (канал-Topic без UU-плейлиста) есть запасной путь через таб Videos канала.
- Переход: `watch?v=<random>&list=UU…` — открывается в контексте плейлиста, кнопка "Следующее" продолжит играть.

## Ограничения

- Очень большие каналы (5000+ видео) грузятся ~30–60 сек на первый клик. Прогресс отображается на кнопке.
- При смене вёрстки YouTube селекторы таб-бара (`yt-tab-group-shape`, `tp-yt-paper-tabs`) могут потребовать обновления.
- innertube — неофициальный API. При его изменениях скрипт нужно править.
