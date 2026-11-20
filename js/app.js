(() => {
  const ANILIST_GRAPHQL_URL = 'https://graphql.anilist.co';
  const KITSU_API_URL = 'https://kitsu.io/api/edge/anime';
  const STORAGE_KEY = 'anime_roulette_watched_v2';
  const DURACION_GIRO_NORMAL_MS = 5000;
  const DURACION_GIRO_REDUCIDO_MS = 800;
  const VUELTAS_NORMALES_DEG = 2160; // 6 vueltas completas
  const VUELTAS_REDUCIDAS_DEG = 360; // 1 vuelta completa
  const REQUEST_TIMEOUT_MS = 8000;
  const TONOS_SAKURA = ['#f8c8d8', '#f4b8cc', '#fad6e3', '#f2afc5'];

  const WHEEL_SEGMENTS = [
    { label: 'Acción', color: '#FF4D6D', genre: 'Action', kitsuSlug: 'action' },
    { label: 'Aventura', color: '#F59E0B', genre: 'Adventure', kitsuSlug: 'adventure' },
    { label: 'Comedia', color: '#10B981', genre: 'Comedy', kitsuSlug: 'comedy' },
    { label: 'Fantasía', color: '#8B5CF6', genre: 'Fantasy', kitsuSlug: 'fantasy' },
    { label: 'Misterio', color: '#06B6D4', genre: 'Mystery', kitsuSlug: 'mystery' },
    { label: 'Slice of Life', color: '#EC4899', genre: 'Slice of Life', kitsuSlug: 'slice-of-life' },
    { label: 'Sci-Fi', color: '#6366F1', genre: 'Sci-Fi', kitsuSlug: 'science-fiction' },
    { label: 'Romance', color: '#F472B6', genre: 'Romance', kitsuSlug: 'romance' },
    { label: 'Sorpresa', color: '#FB7185', genre: '', kitsuSlug: '' },
  ];

  const EXPLICIT_GENRES = new Set(['hentai', 'ecchi', 'erotica']);

  const ANILIST_QUERY = `
    query ($page: Int, $genres: [String], $minScore: Int) {
      Page(page: $page, perPage: 25) {
        pageInfo {
          lastPage
          hasNextPage
        }
        media(
          type: ANIME
          isAdult: false
          genre_not_in: ["Hentai", "Ecchi"]
          sort: POPULARITY_DESC
          genre_in: $genres
          averageScore_greater: $minScore
        ) {
          id
          idMal
          siteUrl
          isAdult
          title {
            romaji
            english
            native
          }
          coverImage {
            extraLarge
            large
          }
          averageScore
          episodes
          status
          seasonYear
          genres
          description(asHtml: false)
        }
      }
    }
  `;

  const poolCache = new Map();

  const state = {
    genre: '',
    minScore: '7.5',
    rotation: 0,
    animationFrameId: null,
    revealTimers: [],
    activePetals: [],
    isSpinning: false,
    currentAnime: null,
    lastShownId: null,
    expandedSynopsis: false,
    confirmReset: false,
    watchedList: loadWatched(),
  };

  // DOM References
  const rouletteSvg = document.getElementById('roulette-svg');
  const pointerNeedle = document.getElementById('wheel-pointer-needle');
  const genreButtonsContainer = document.getElementById('genre-buttons');
  const minScoreSelect = document.getElementById('min-score-select');
  const headerSpinBtn = document.getElementById('header-spin-btn');
  const mainSpinBtn = document.getElementById('main-spin-btn');
  const wheelHubBtn = document.getElementById('wheel-hub-btn');
  const wheelHubText = document.getElementById('wheel-hub-text');
  const emptySpinBtn = document.getElementById('empty-spin-btn');
  const retrySpinBtn = document.getElementById('retry-spin-btn');
  const clearFiltersBtn = document.getElementById('clear-filters-btn');
  const nextSpinBtn = document.getElementById('next-spin-btn');

  const stateIdle = document.getElementById('state-idle');
  const stateLoading = document.getElementById('state-loading');
  const stateError = document.getElementById('state-error');
  const animeCard = document.getElementById('anime-card');
  const loadingDetail = document.getElementById('loading-detail');
  const errorMessage = document.getElementById('error-message');

  const animePoster = document.getElementById('anime-poster');
  const posterFallback = document.getElementById('poster-fallback');
  const posterFallbackTitle = document.getElementById('poster-fallback-title');
  const animeScore = document.getElementById('anime-score');
  const animeEpisodes = document.getElementById('anime-episodes');
  const animeStatus = document.getElementById('anime-status');
  const animeYearSep = document.getElementById('anime-year-sep');
  const animeYear = document.getElementById('anime-year');
  const animeTitle = document.getElementById('anime-title');
  const animeSubtitles = document.getElementById('anime-subtitles');
  const animeGenres = document.getElementById('anime-genres');
  const animeSynopsis = document.getElementById('anime-synopsis');
  const toggleSynopsisBtn = document.getElementById('toggle-synopsis-btn');
  const markWatchedBtn = document.getElementById('mark-watched-btn');
  const malLink = document.getElementById('mal-link');

  const navWatchedCount = document.getElementById('nav-watched-count');
  const excludedCount = document.getElementById('excluded-count');
  const historySummary = document.getElementById('history-summary');
  const resetControls = document.getElementById('reset-controls');
  const cancelResetBtn = document.getElementById('cancel-reset-btn');
  const resetHistoryBtn = document.getElementById('reset-history-btn');
  const watchedGrid = document.getElementById('watched-grid');

  function loadWatched() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function saveWatched() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state.watchedList));
    } catch {
      // Ignorar errores de cuota de almacenamiento
    }
  }

  function getWatchedIdsSet() {
    return new Set(state.watchedList.map((item) => item.id));
  }

  function cleanHtmlSynopsis(raw) {
    if (!raw) {
      return 'No hay sinopsis disponible para este título en la base de datos.';
    }
    return raw
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<\/?[^>]+(>|$)/g, '')
      .replace(/&quot;/g, '"')
      .replace(/&#039;|&apos;/g, "'")
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

  function polarToCartesian(cx, cy, r, angleDeg) {
    const rad = ((angleDeg - 90) * Math.PI) / 180;
    return {
      x: cx + r * Math.cos(rad),
      y: cy + r * Math.sin(rad),
    };
  }

  function describeArcWedge(cx, cy, outerR, innerR, startAngle, endAngle) {
    const startOuter = polarToCartesian(cx, cy, outerR, endAngle);
    const endOuter = polarToCartesian(cx, cy, outerR, startAngle);
    const startInner = polarToCartesian(cx, cy, innerR, endAngle);
    const endInner = polarToCartesian(cx, cy, innerR, startAngle);
    const largeArcFlag = endAngle - startAngle <= 180 ? '0' : '1';

    return [
      'M', startOuter.x, startOuter.y,
      'A', outerR, outerR, 0, largeArcFlag, 0, endOuter.x, endOuter.y,
      'L', endInner.x, endInner.y,
      'A', innerR, innerR, 0, largeArcFlag, 1, startInner.x, startInner.y,
      'Z',
    ].join(' ');
  }

  function renderWheel() {
    const segmentAngle = 360 / WHEEL_SEGMENTS.length;
    const parts = ['<circle cx="160" cy="160" r="150" fill="#0E121B" />'];

    WHEEL_SEGMENTS.forEach((seg, index) => {
      const start = index * segmentAngle;
      const end = start + segmentAngle;
      const mid = start + segmentAngle / 2;
      const pos = polarToCartesian(160, 160, 102, mid);
      const isHighlighted = state.genre === '' || state.genre === seg.genre;
      const fillOpacity = isHighlighted ? '0.88' : '0.24';

      parts.push(
        `<path class="wheel-segment" data-segment-index="${index}" d="${describeArcWedge(160, 160, 146, 48, start, end)}" fill="${seg.color}" fill-opacity="${fillOpacity}" stroke="#090B10" stroke-width="2.5" />`
      );
      parts.push(
        `<path d="${describeArcWedge(160, 160, 146, 138, start, end)}" fill="${seg.color}" fill-opacity="0.92" stroke="#090B10" stroke-width="1.5" />`
      );
      parts.push(
        `<text x="${pos.x}" y="${pos.y}" fill="#F8FAFC" font-size="11" font-weight="600" font-family="Outfit, sans-serif" text-anchor="middle" dominant-baseline="middle" transform="rotate(${mid + 90}, ${pos.x}, ${pos.y})">${seg.label}</text>`
      );
    });

    parts.push('<g id="winner-glow-layer" class="winner-glow-overlay" aria-hidden="true"></g>');
    parts.push('<circle cx="160" cy="160" r="48" fill="#121620" stroke="#090B10" stroke-width="3" />');
    rouletteSvg.innerHTML = parts.join('');
  }

  function translateStatus(status) {
    if (!status) return 'Desconocido';
    switch (status.toUpperCase()) {
      case 'FINISHED':
      case 'FINISHED AIRING':
        return 'Finalizado';
      case 'RELEASING':
      case 'CURRENT':
      case 'CURRENTLY AIRING':
        return 'En emisión';
      case 'NOT_YET_RELEASED':
      case 'UPCOMING':
      case 'TBA':
        return 'Próximamente';
      case 'CANCELLED':
        return 'Cancelado';
      case 'HIATUS':
        return 'En pausa';
      default:
        return status;
    }
  }

  function showStage(stageName) {
    stateIdle.classList.toggle('is-hidden', stageName !== 'idle');
    stateLoading.classList.toggle('is-hidden', stageName !== 'loading');
    stateError.classList.toggle('is-hidden', stageName !== 'error');
    animeCard.classList.toggle('is-hidden', stageName !== 'result');
  }

  function setSpinningUI(spinning) {
    state.isSpinning = spinning;
    [
      headerSpinBtn,
      mainSpinBtn,
      wheelHubBtn,
      emptySpinBtn,
      retrySpinBtn,
      nextSpinBtn,
      minScoreSelect,
    ].forEach((el) => {
      el.disabled = spinning;
    });
    genreButtonsContainer.querySelectorAll('button').forEach((btn) => {
      btn.disabled = spinning;
    });
    mainSpinBtn.textContent = spinning ? 'Girando ruleta…' : 'Girar / Recomendar Anime';
    headerSpinBtn.textContent = spinning ? 'Girando…' : 'Girar ruleta';
    wheelHubText.textContent = spinning ? 'Girando' : 'Girar';
  }

  async function fetchAniListPage(genre, minScore, page) {
    const variables = { page };
    if (genre) variables.genres = [genre];
    if (minScore) {
      variables.minScore = Math.max(1, Math.round(parseFloat(minScore) * 10) - 1);
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(ANILIST_GRAPHQL_URL, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ query: ANILIST_QUERY, variables }),
      });

      if (!response.ok) {
        throw new Error(`Error HTTP ${response.status} al consultar AniList.`);
      }

      const json = await response.json();
      if (json.errors && json.errors.length) {
        throw new Error(json.errors[0].message || 'Error al consultar el catálogo.');
      }

      const pageData = json.data && json.data.Page ? json.data.Page : {};
      const mediaList = (pageData.media || []).filter((media) => {
        if (media.isAdult) return false;
        if (!Array.isArray(media.genres)) return true;
        return !media.genres.some((g) => EXPLICIT_GENRES.has(String(g).toLowerCase()));
      });
      const lastPage = pageData.pageInfo ? pageData.pageInfo.lastPage : 1;

      const items = mediaList.map((media) => {
        const malId = typeof media.idMal === 'number' ? media.idMal : null;
        return {
          id: malId ?? media.id,
          malId,
          url: malId ? `https://myanimelist.net/anime/${malId}` : media.siteUrl,
          title: (media.title && (media.title.romaji || media.title.english)) || 'Anime sin título',
          titleEnglish: media.title ? media.title.english : null,
          titleJapanese: media.title ? media.title.native : null,
          imageUrl:
            (media.coverImage && (media.coverImage.extraLarge || media.coverImage.large)) || '',
          score: typeof media.averageScore === 'number' ? media.averageScore / 10 : null,
          episodes: media.episodes,
          status: media.status,
          year: media.seasonYear,
          genres: Array.isArray(media.genres) ? media.genres.slice(0, 6) : [],
          synopsis: cleanHtmlSynopsis(media.description),
        };
      });

      return {
        items,
        lastPage: Math.max(1, Math.min(lastPage || 1, 18)),
      };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async function fetchKitsuPage(genre, minScore, page) {
    const limit = 20;
    const offset = (page - 1) * limit;
    const params = new URLSearchParams({
      'page[limit]': String(limit),
      'page[offset]': String(offset),
      'filter[ageRating]': 'G,PG',
      sort: '-userCount',
    });

    const seg = WHEEL_SEGMENTS.find((s) => s.genre === genre);
    if (seg && seg.kitsuSlug) {
      params.set('filter[categories]', seg.kitsuSlug);
    }
    if (minScore) {
      const minRating = Math.round(parseFloat(minScore) * 10);
      params.set('filter[averageRating]', `${minRating}..100`);
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(`${KITSU_API_URL}?${params.toString()}`, {
        signal: controller.signal,
        headers: { Accept: 'application/vnd.api+json' },
      });

      if (!response.ok) {
        throw new Error(`Error HTTP ${response.status} al consultar Kitsu.`);
      }

      const json = await response.json();
      const totalCount = (json.meta && json.meta.count) || 20;
      const lastPage = Math.max(1, Math.min(Math.ceil(totalCount / limit), 12));

      const safeRecords = (json.data || []).filter((rec) => {
        const attr = rec.attributes || {};
        return !attr.nsfw && attr.ageRating !== 'R18' && attr.ageRating !== 'R';
      });

      const items = safeRecords.map((rec) => {
        const attr = rec.attributes || {};
        const numericRating = attr.averageRating ? parseFloat(attr.averageRating) / 10 : null;
        const year = attr.startDate ? parseInt(attr.startDate.slice(0, 4), 10) : null;
        return {
          id: Number(rec.id) + 1000000,
          malId: null,
          url: `https://kitsu.io/anime/${attr.slug}`,
          title: attr.canonicalTitle || 'Anime sin título',
          titleEnglish: attr.titles ? attr.titles.en : null,
          titleJapanese: attr.titles ? attr.titles.ja_jp : null,
          imageUrl:
            (attr.posterImage &&
              (attr.posterImage.large || attr.posterImage.original || attr.posterImage.medium)) ||
            '',
          score: numericRating && !Number.isNaN(numericRating) ? numericRating : null,
          episodes: attr.episodeCount ?? null,
          status: attr.status || null,
          year: year && !Number.isNaN(year) ? year : null,
          genres: seg && seg.genre ? [seg.label] : [],
          synopsis: cleanHtmlSynopsis(attr.synopsis),
        };
      });

      return { items, lastPage };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async function pickFromProvider(providerName, fetcher) {
    const cacheKey = `${providerName}::${state.genre || 'all'}::${state.minScore || 'any'}`;
    let pool = poolCache.get(cacheKey);

    if (!pool) {
      const firstPage = await fetcher(state.genre, state.minScore, 1);
      pool = {
        lastVisiblePage: firstPage.lastPage,
        pages: new Map([[1, firstPage.items]]),
      };
      poolCache.set(cacheKey, pool);
    }

    const watchedIds = getWatchedIdsSet();
    const maxAttempts = Math.min(4, pool.lastVisiblePage);
    const triedPages = new Set();

    for (let i = 0; i < maxAttempts; i++) {
      let page = Math.floor(Math.random() * pool.lastVisiblePage) + 1;
      while (triedPages.has(page) && triedPages.size < pool.lastVisiblePage) {
        page = (page % pool.lastVisiblePage) + 1;
      }
      triedPages.add(page);

      let items = pool.pages.get(page);
      if (!items) {
        const res = await fetcher(state.genre, state.minScore, page);
        items = res.items;
        pool.pages.set(page, items);
      }

      const eligible = items.filter(
        (item) =>
          !watchedIds.has(item.id) &&
          (items.length <= 1 || item.id !== state.lastShownId)
      );

      if (eligible.length > 0) {
        return eligible[Math.floor(Math.random() * eligible.length)];
      }
    }

    const fallbackPool = [];
    pool.pages.forEach((items) => {
      items.forEach((item) => {
        if (!watchedIds.has(item.id)) {
          fallbackPool.push(item);
        }
      });
    });

    if (fallbackPool.length > 0) {
      const nonRepeat = fallbackPool.filter((item) => item.id !== state.lastShownId);
      const source = nonRepeat.length > 0 ? nonRepeat : fallbackPool;
      return source[Math.floor(Math.random() * source.length)];
    }

    throw new Error('NO_UNWATCHED_MATCHES');
  }

  async function pickRandomAnime() {
    try {
      return await pickFromProvider('anilist', fetchAniListPage);
    } catch (primaryErr) {
      if (primaryErr && primaryErr.message === 'NO_UNWATCHED_MATCHES') {
        throw new Error(
          'No quedan animes sin ver con estos filtros. Prueba bajar la puntuación o reiniciar tu historial.'
        );
      }
      try {
        return await pickFromProvider('kitsu', fetchKitsuPage);
      } catch (fallbackErr) {
        if (fallbackErr && fallbackErr.message === 'NO_UNWATCHED_MATCHES') {
          throw new Error(
            'No quedan animes sin ver con estos filtros. Prueba bajar la puntuación o reiniciar tu historial.'
          );
        }
        throw new Error(
          'No se pudo conectar con los servidores de anime en este momento. Verifica tu conexión e inténtalo de nuevo.'
        );
      }
    }
  }

  function renderSynopsis(fullText) {
    const isLong = fullText.length > 340;
    if (!isLong) {
      animeSynopsis.textContent = fullText;
      toggleSynopsisBtn.classList.add('is-hidden');
      return;
    }

    toggleSynopsisBtn.classList.remove('is-hidden');
    if (state.expandedSynopsis) {
      animeSynopsis.textContent = fullText;
      toggleSynopsisBtn.textContent = 'Mostrar menos';
    } else {
      animeSynopsis.textContent = `${fullText.slice(0, 340).trimEnd()}…`;
      toggleSynopsisBtn.textContent = 'Leer sinopsis completa';
    }
  }

  function renderAnimeCard(anime) {
    state.currentAnime = anime;
    state.lastShownId = anime.id;
    state.expandedSynopsis = false;

    const primaryTitle = anime.titleEnglish || anime.title;
    const secondaryTitle =
      anime.titleEnglish && anime.titleEnglish !== anime.title ? anime.title : null;
    const subtitles = [secondaryTitle, anime.titleJapanese].filter(Boolean).join(' · ');

    animeTitle.textContent = primaryTitle;
    animeSubtitles.textContent = subtitles;
    animeSubtitles.classList.toggle('is-hidden', !subtitles);

    animeScore.textContent = anime.score ? `★ ${anime.score.toFixed(2)}` : '★ N/D';
    animeEpisodes.textContent = anime.episodes
      ? `${anime.episodes} episodios`
      : 'Episodios por confirmar';
    animeStatus.textContent = translateStatus(anime.status);

    if (anime.year) {
      animeYearSep.classList.remove('is-hidden');
      animeYear.textContent = String(anime.year);
    } else {
      animeYearSep.classList.add('is-hidden');
      animeYear.textContent = '';
    }

    posterFallbackTitle.textContent = primaryTitle;
    if (anime.imageUrl) {
      animePoster.classList.remove('is-hidden');
      posterFallback.classList.add('is-hidden');
      animePoster.alt = `Portada oficial de ${primaryTitle}`;
      animePoster.src = anime.imageUrl;
    } else {
      animePoster.classList.add('is-hidden');
      posterFallback.classList.remove('is-hidden');
    }

    animeGenres.innerHTML = '';
    (anime.genres || []).forEach((genre) => {
      const span = document.createElement('span');
      span.className = 'genre-tag';
      span.textContent = genre;
      animeGenres.appendChild(span);
    });

    animeSynopsis.dataset.fullText = anime.synopsis;
    renderSynopsis(anime.synopsis);

    malLink.href = anime.url;
    malLink.textContent = anime.malId
      ? 'Ver ficha en MyAnimeList ↗'
      : 'Ver ficha completa ↗';

    updateMarkWatchedButton();
    // Prepara la ficha oculta antes de iniciar la línea de tiempo de revelación
    animeCard.classList.remove('visible');
    animeCard.classList.add('oculta');
    showStage('result');
  }

  function updateMarkWatchedButton() {
    if (!state.currentAnime) return;
    const isWatched = getWatchedIdsSet().has(state.currentAnime.id);
    markWatchedBtn.disabled = isWatched;
    markWatchedBtn.textContent = isWatched ? 'Marcado como visto' : 'Ya lo vi';
    markWatchedBtn.classList.toggle('btn-watched', isWatched);
    markWatchedBtn.classList.toggle('btn-secondary', !isWatched);
  }

  function renderWatchedHistory() {
    const count = state.watchedList.length;
    navWatchedCount.textContent = String(count);
    excludedCount.textContent = String(count);

    if (count === 0) {
      historySummary.textContent = 'Todavía no marcaste ningún título como visto.';
      resetControls.classList.add('is-hidden');
      watchedGrid.innerHTML = '';
      return;
    }

    historySummary.textContent = `${count} ${
      count === 1 ? 'título guardado' : 'títulos guardados'
    } en tu navegador para no repetir recomendaciones.`;
    resetControls.classList.remove('is-hidden');

    watchedGrid.innerHTML = '';
    state.watchedList.forEach((entry) => {
      const card = document.createElement('div');
      card.className = 'watched-item';

      const main = document.createElement('div');
      main.className = 'watched-item-main';

      if (entry.image_url) {
        const img = document.createElement('img');
        img.className = 'watched-thumb';
        img.src = entry.image_url;
        img.alt = entry.title;
        img.referrerPolicy = 'no-referrer';
        main.appendChild(img);
      }

      const textBox = document.createElement('div');
      textBox.className = 'watched-text';

      const titleEl = document.createElement('p');
      titleEl.className = 'watched-title';
      titleEl.textContent = entry.title;

      const scoreEl = document.createElement('p');
      scoreEl.className = 'watched-score';
      scoreEl.textContent = entry.score
        ? `Puntuación ${Number(entry.score).toFixed(2)}`
        : 'Sin puntuación';

      textBox.appendChild(titleEl);
      textBox.appendChild(scoreEl);
      main.appendChild(textBox);

      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'remove-btn';
      removeBtn.textContent = 'Quitar';
      removeBtn.setAttribute('aria-label', `Quitar ${entry.title} del historial`);
      removeBtn.addEventListener('click', () => {
        state.watchedList = state.watchedList.filter((item) => item.id !== entry.id);
        saveWatched();
        renderWatchedHistory();
        updateMarkWatchedButton();
      });

      card.appendChild(main);
      card.appendChild(removeBtn);
      watchedGrid.appendChild(card);
    });
  }

  // Curva de desaceleración realista (easeOutQuart)
  function easeOutQuart(t) {
    return 1 - Math.pow(1 - t, 4);
  }

  // Determina el índice del segmento ganador según el filtro o los géneros del anime elegido
  function obtenerIndiceGanador(anime) {
    if (state.genre) {
      const idxFiltro = WHEEL_SEGMENTS.findIndex((seg) => seg.genre === state.genre);
      if (idxFiltro !== -1) return idxFiltro;
    }

    if (anime && Array.isArray(anime.genres)) {
      const idxAnime = WHEEL_SEGMENTS.findIndex(
        (seg) =>
          seg.genre &&
          anime.genres.some((g) => String(g).toLowerCase() === seg.genre.toLowerCase())
      );
      if (idxAnime !== -1) return idxAnime;
    }

    return WHEEL_SEGMENTS.length - 1; // Segmento "Sorpresa"
  }

  // Calcula el ángulo final exacto para alinear el segmento ganador con el puntero superior
  function calcularAnguloFinal(indiceGanador, vueltasBaseDeg) {
    const anguloSegmento = 360 / WHEEL_SEGMENTS.length;
    const centroSegmento = indiceGanador * anguloSegmento + anguloSegmento / 2;
    const restoObjetivo = (360 - (centroSegmento % 360)) % 360;
    const actualNormalizado = ((state.rotation % 360) + 360) % 360;
    const offsetHastaGanador = (restoObjetivo - actualNormalizado + 360) % 360;

    return state.rotation + vueltasBaseDeg + offsetHastaGanador;
  }

  // Dispara el latido visual del puntero con intensidad proporcional a la velocidad
  function dispararTick(gradosRecorridos, deltaMs) {
    if (!pointerNeedle) return;

    // Convierte la velocidad instantánea (°/ms) a un rango entre -6deg (lento) y -16deg (rápido)
    const velocidadPorMs = gradosRecorridos / Math.max(deltaMs, 1);
    const intensidad = Math.min(Math.max(velocidadPorMs / 1.5, 0), 1);
    const anguloTick = -(6 + 10 * intensidad);

    pointerNeedle.style.setProperty('--tick-angle', `${anguloTick.toFixed(2)}deg`);
    pointerNeedle.classList.remove('is-ticking');
    // Fuerza un reflow para reiniciar la animación CSS de 90ms en cada cruce
    void pointerNeedle.offsetWidth;
    pointerNeedle.classList.add('is-ticking');
  }

  // Anima la rotación del SVG con requestAnimationFrame y desaceleración easeOutQuart
  function animarRuleta(
    elemento,
    anguloInicial,
    anguloFinal,
    duracion,
    permitirEfectosVisuales,
    alFinalizar
  ) {
    if (state.animationFrameId !== null) {
      window.cancelAnimationFrame(state.animationFrameId);
      state.animationFrameId = null;
    }

    elemento.style.filter = '';

    const tamanoSegmento = 360 / WHEEL_SEGMENTS.length;
    let ultimoSegmento = Math.floor(anguloInicial / tamanoSegmento);
    let anguloAnterior = anguloInicial;
    let tiempoInicio = null;
    let ultimoTimestamp = null;
    let ultimoBlur = 0;

    function cuadro(timestamp) {
      if (tiempoInicio === null) {
        tiempoInicio = timestamp;
        ultimoTimestamp = timestamp;
      }

      const deltaMs = Math.max(timestamp - ultimoTimestamp, 1);
      const progreso = Math.min((timestamp - tiempoInicio) / duracion, 1);
      const factorSuavizado = easeOutQuart(progreso);
      const anguloActual = anguloInicial + (anguloFinal - anguloInicial) * factorSuavizado;
      const velocidad = Math.abs(anguloActual - anguloAnterior); // grados recorridos en este frame

      elemento.style.transform = `rotate(${anguloActual}deg)`;

      // Motion blur continuo proporcional a la velocidad (versión continua activa; corta < 0.25px en el último tercio para evitar repaints y mantener nitidez al frenar)
      if (permitirEfectosVisuales && progreso < 1) {
        const blurBruto = Math.min(velocidad * (16.67 / deltaMs) * 0.1, 3);
        const blurAplicado = blurBruto >= 0.25 ? Number(blurBruto.toFixed(1)) : 0;

        if (blurAplicado !== ultimoBlur) {
          elemento.style.filter = blurAplicado > 0 ? `blur(${blurAplicado}px)` : '';
          ultimoBlur = blurAplicado;
        }
      }

      // Detecta el cruce de cada segmento para disparar el tick del puntero
      const segmentoActual = Math.floor(anguloActual / tamanoSegmento);
      if (permitirEfectosVisuales && segmentoActual !== ultimoSegmento) {
        dispararTick(velocidad, deltaMs);
        ultimoSegmento = segmentoActual;
      }

      anguloAnterior = anguloActual;
      ultimoTimestamp = timestamp;

      if (progreso < 1) {
        state.animationFrameId = window.requestAnimationFrame(cuadro);
      } else {
        // Fija exactamente el ángulo ganador y limpia el filter explícitamente al terminar
        elemento.style.transform = `rotate(${anguloFinal}deg)`;
        elemento.style.filter = '';
        state.rotation = anguloFinal;
        state.animationFrameId = null;
        alFinalizar();
      }
    }

    state.animationFrameId = window.requestAnimationFrame(cuadro);
  }

  // Elimina de inmediato cualquier pétalo pendiente de una revelación anterior
  function limpiarPetalos() {
    state.activePetals.forEach((petalo) => {
      window.clearTimeout(petalo.timerId);
      petalo.el.remove();
    });
    state.activePetals = [];
  }

  // Genera entre 8 y 12 pétalos de sakura al finalizar la secuencia de revelación
  function lanzarPetalosSakura() {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    limpiarPetalos();

    const cantidad = 8 + Math.floor(Math.random() * 5);
    for (let i = 0; i < cantidad; i++) {
      const petaloEl = document.createElement('div');
      petaloEl.className = 'sakura-petalo';
      petaloEl.setAttribute('aria-hidden', 'true');

      const ancho = 8 + Math.random() * 6;
      const alto = 8 + Math.random() * 6;
      const leftPct = 5 + Math.random() * 90;
      const duracionS = 2 + Math.random() * 2;
      const retrasoMs = Math.round(Math.random() * 600);
      const opacidad = 0.6 + Math.random() * 0.3;
      const color = TONOS_SAKURA[Math.floor(Math.random() * TONOS_SAKURA.length)];

      petaloEl.style.width = `${ancho.toFixed(1)}px`;
      petaloEl.style.height = `${alto.toFixed(1)}px`;
      petaloEl.style.left = `${leftPct.toFixed(2)}%`;
      petaloEl.style.background = color;
      petaloEl.style.setProperty('--petalo-opacity', opacidad.toFixed(2));
      petaloEl.style.animationDuration = `${duracionS.toFixed(2)}s`;
      petaloEl.style.animationDelay = `${retrasoMs}ms`;

      const registro = { el: petaloEl, timerId: 0 };

      function eliminarPetalo() {
        window.clearTimeout(registro.timerId);
        petaloEl.remove();
        state.activePetals = state.activePetals.filter((item) => item !== registro);
      }

      petaloEl.addEventListener('animationend', eliminarPetalo, { once: true });
      registro.timerId = window.setTimeout(
        eliminarPetalo,
        Math.round(duracionS * 1000) + retrasoMs + 200
      );

      state.activePetals.push(registro);
      document.body.appendChild(petaloEl);
    }
  }

  // Cancela cualquier timer pendiente de una secuencia de revelación anterior
  function cancelarSecuenciaRevelacion() {
    state.revealTimers.forEach((timerId) => window.clearTimeout(timerId));
    state.revealTimers = [];
    rouletteSvg.querySelectorAll('.segmento-ganador').forEach((el) => {
      el.classList.remove('segmento-ganador');
    });
    const glowLayer = document.getElementById('winner-glow-layer');
    if (glowLayer) {
      glowLayer.classList.remove('is-active');
      glowLayer.innerHTML = '';
    }
  }

  // Construye el contenido SVG de la capa superpuesta del brillo ganador
  function renderWinnerGlowLayer(indiceGanador) {
    const glowLayer = document.getElementById('winner-glow-layer');
    const seg = WHEEL_SEGMENTS[indiceGanador];
    if (!glowLayer || !seg) return;

    const segmentAngle = 360 / WHEEL_SEGMENTS.length;
    const start = indiceGanador * segmentAngle;
    const end = start + segmentAngle;
    const mid = start + segmentAngle / 2;
    const pos = polarToCartesian(160, 160, 102, mid);
    const wedgePath = describeArcWedge(160, 160, 146, 48, start, end);

    glowLayer.innerHTML = [
      `<path d="${wedgePath}" fill="none" stroke="rgba(255, 215, 130, 0.45)" stroke-width="7" stroke-linejoin="round" />`,
      `<path d="${wedgePath}" fill="#FFD782" fill-opacity="0.28" stroke="#FFE699" stroke-width="2.75" stroke-linejoin="round" />`,
      `<text x="${pos.x}" y="${pos.y}" fill="#FFFFFF" font-size="11" font-weight="700" font-family="Outfit, sans-serif" text-anchor="middle" dominant-baseline="middle" transform="rotate(${mid + 90}, ${pos.x}, ${pos.y})">${seg.label}</text>`,
    ].join('');
  }

  // Orquesta la secuencia coreografiada tras detenerse la ruleta (0ms -> 400ms -> 800ms -> 1400ms)
  function ejecutarSecuenciaRevelacion(indiceGanador, prefiereMovimientoReducido) {
    cancelarSecuenciaRevelacion();

    if (prefiereMovimientoReducido) {
      // t+0ms: Sin brillo del segmento; ficha lista en .oculta (solo fade de 200ms)
      const timerFade = window.setTimeout(() => {
        animeCard.classList.remove('oculta');
        animeCard.classList.add('visible');
      }, 20);

      // t+240ms (<= 300ms): Fin de secuencia reducida y reactivación de botones
      const timerFin = window.setTimeout(() => {
        state.revealTimers = [];
        setSpinningUI(false);
      }, 240);

      state.revealTimers.push(timerFade, timerFin);
      return;
    }

    const segmentoPath = rouletteSvg.querySelector(
      `path.wheel-segment[data-segment-index="${indiceGanador}"]`
    );
    const glowLayer = document.getElementById('winner-glow-layer');
    renderWinnerGlowLayer(indiceGanador);

    // t+400ms: El segmento ganador resalta con un brillo dorado suave
    const timerBrillo = window.setTimeout(() => {
      if (segmentoPath) {
        segmentoPath.classList.add('segmento-ganador');
      }
      if (glowLayer) {
        glowLayer.classList.add('is-active');
      }
    }, 400);

    // t+800ms: La ficha del anime se desliza desde abajo con fade y ligero scale
    const timerFicha = window.setTimeout(() => {
      animeCard.classList.remove('oculta');
      animeCard.classList.add('visible');
    }, 800);

    // t+1400ms: Fin de la secuencia; inicia el desvanecimiento del brillo, se reactiva el botón y caen los pétalos
    const timerFin = window.setTimeout(() => {
      if (segmentoPath) {
        segmentoPath.classList.remove('segmento-ganador');
      }
      if (glowLayer) {
        glowLayer.classList.remove('is-active');
      }
      setSpinningUI(false);
      lanzarPetalosSakura();
    }, 1400);

    // t+1820ms: Limpia el contenido de la capa al completar el fade-out
    const timerLimpieza = window.setTimeout(() => {
      if (glowLayer) {
        glowLayer.innerHTML = '';
      }
      state.revealTimers = [];
    }, 1820);

    state.revealTimers.push(timerBrillo, timerFicha, timerFin, timerLimpieza);
  }

  async function handleSpin() {
    if (state.isSpinning) return;

    limpiarPetalos();
    cancelarSecuenciaRevelacion();
    state.confirmReset = false;
    updateResetUI();
    setSpinningUI(true);
    showStage('loading');

    const activeBtn = genreButtonsContainer.querySelector('.genre-btn.is-active');
    const genreLabel = activeBtn ? activeBtn.textContent : 'Todos';
    loadingDetail.textContent = `Filtrando por ${genreLabel}${
      state.minScore ? ` · puntuación +${state.minScore}` : ''
    }`;

    try {
      // Calcula primero el anime elegido y luego anima la ruleta hasta su segmento ganador
      const selected = await pickRandomAnime();
      const prefiereMovimientoReducido = window.matchMedia(
        '(prefers-reduced-motion: reduce)'
      ).matches;

      const duracion = prefiereMovimientoReducido
        ? DURACION_GIRO_REDUCIDO_MS
        : DURACION_GIRO_NORMAL_MS;
      const vueltasBase = prefiereMovimientoReducido
        ? VUELTAS_REDUCIDAS_DEG
        : VUELTAS_NORMALES_DEG;

      const indiceGanador = obtenerIndiceGanador(selected);
      const anguloInicial = state.rotation;
      const anguloFinal = calcularAnguloFinal(indiceGanador, vueltasBase);

      loadingDetail.textContent = prefiereMovimientoReducido
        ? 'Girando ruleta…'
        : 'Girando ruleta hacia tu recomendación…';

      animarRuleta(
        rouletteSvg,
        anguloInicial,
        anguloFinal,
        duracion,
        !prefiereMovimientoReducido,
        () => {
          // t+0ms: La ruleta se detiene; se rellena la ficha oculta y arranca la secuencia
          renderAnimeCard(selected);
          ejecutarSecuenciaRevelacion(indiceGanador, prefiereMovimientoReducido);
        }
      );
    } catch (error) {
      cancelarSecuenciaRevelacion();
      errorMessage.textContent =
        error && error.message
          ? error.message
          : 'No fue posible obtener una recomendación en este momento.';
      showStage('error');
      setSpinningUI(false);
    }
  }

  function updateResetUI() {
    cancelResetBtn.classList.toggle('is-hidden', !state.confirmReset);
    resetHistoryBtn.textContent = state.confirmReset
      ? 'Confirmar reinicio'
      : 'Reiniciar historial';
    resetHistoryBtn.classList.toggle('btn-danger', state.confirmReset);
    resetHistoryBtn.classList.toggle('btn-secondary', !state.confirmReset);
  }

  genreButtonsContainer.addEventListener('click', (event) => {
    const btn = event.target.closest('.genre-btn');
    if (!btn || state.isSpinning) return;

    genreButtonsContainer.querySelectorAll('.genre-btn').forEach((item) => {
      item.classList.remove('is-active');
    });
    btn.classList.add('is-active');
    state.genre = btn.dataset.genre || '';
    renderWheel();
  });

  minScoreSelect.addEventListener('change', (event) => {
    state.minScore = event.target.value;
  });

  [headerSpinBtn, mainSpinBtn, wheelHubBtn, emptySpinBtn, retrySpinBtn, nextSpinBtn].forEach(
    (btn) => {
      btn.addEventListener('click', handleSpin);
    }
  );

  clearFiltersBtn.addEventListener('click', () => {
    state.genre = '';
    state.minScore = '';
    minScoreSelect.value = '';
    genreButtonsContainer.querySelectorAll('.genre-btn').forEach((btn) => {
      btn.classList.toggle('is-active', btn.dataset.genre === '');
    });
    renderWheel();
    showStage('idle');
  });

  animePoster.addEventListener('error', () => {
    animePoster.classList.add('is-hidden');
    posterFallback.classList.remove('is-hidden');
  });

  toggleSynopsisBtn.addEventListener('click', () => {
    state.expandedSynopsis = !state.expandedSynopsis;
    renderSynopsis(animeSynopsis.dataset.fullText || '');
  });

  markWatchedBtn.addEventListener('click', () => {
    if (!state.currentAnime) return;
    const watchedIds = getWatchedIdsSet();
    if (watchedIds.has(state.currentAnime.id)) return;

    state.watchedList.unshift({
      id: state.currentAnime.id,
      title: state.currentAnime.titleEnglish || state.currentAnime.title,
      image_url: state.currentAnime.imageUrl || null,
      score: state.currentAnime.score,
      watchedAt: Date.now(),
    });

    saveWatched();
    renderWatchedHistory();
    updateMarkWatchedButton();
  });

  cancelResetBtn.addEventListener('click', () => {
    state.confirmReset = false;
    updateResetUI();
  });

  resetHistoryBtn.addEventListener('click', () => {
    if (!state.confirmReset) {
      state.confirmReset = true;
      updateResetUI();
      return;
    }

    state.watchedList = [];
    state.confirmReset = false;
    saveWatched();
    renderWatchedHistory();
    updateMarkWatchedButton();
    updateResetUI();
  });

  renderWheel();
  renderWatchedHistory();
  showStage('idle');
})();
