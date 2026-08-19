<div align="center">
  <h1>Portugal Box Office Tracker</h1>
  <p><strong>Bilheteira, sessões e ocupação de salas de cinema em Portugal, em tempo real</strong></p>
</div>

---

## Visão Geral

Aplicação full-stack para acompanhar a bilheteira de cinema em Portugal — filmes em exibição, sessões, lugares vendidos e receita — começando pela NOS Cinemas. Nasceu de um interesse pessoal por estatísticas de box office (nacional e internacional) e serviu para praticar full-stack (React + Node + PostgreSQL) com apoio de ferramentas de AI (Google AI Studio / Gemini) no desenvolvimento.

---

## Funcionalidades Principais

- **Recolha automática** de dados de sessões, lugares vendidos e receita, correndo de 15 em 15 minutos
- **Rankings de bilheteira** semanal e de fim de semana
- **Curvas de pré-venda** por filme, mostrando a evolução das vendas antes da estreia
- **Breakdown horário e diário** de receita e ocupação por filme e por sessão
- **Previsão intraday** de receita com base no ritmo de vendas do dia
- **Catálogo de filmes** com histórico completo por título

---

## Stack Tecnológica

| Camada | Tecnologia |
|--------|------------|
| Frontend | React + TypeScript, Vite |
| Backend | Node.js + Express, TypeScript |
| Recolha de dados | Python (scraper/parser dedicado) |
| Base de Dados | PostgreSQL |
| IA | Google Gemini API |

---

## Recolha de Dados

### Como os dados são extraídos do site da NOS

O site da NOS Cinemas é construído sobre **OutSystems** (uma plataforma low-code) e não expõe nenhuma API pública de bilheteira ou vendas. O scraper (`nos_scraper.py`) funciona replicando, via pedidos HTTP diretos, os mesmos passos que um browser executa quando um utilizador navega até ao ecrã de escolha de lugares — sem nunca chegar a finalizar uma compra:

1. **Catálogo e sessões** — os filmes em exibição e os horários de sessões são obtidos através dos endpoints GraphQL públicos do site (`getMoviesInTheaters`, `getMovieSessions`, etc.)
2. **Início de sessão** — é feito um pedido inicial que faz o backend da NOS emitir cookies de sessão, das quais é extraído um token CSRF necessário para os pedidos seguintes
3. **Contexto de reserva** — é criado um contexto de reserva temporário (o mesmo passo que o site faz quando alguém começa a escolher lugares), o que desbloqueia o acesso ao mapa de lugares dessa sessão
4. **Mapa de lugares em tempo real** — o scraper lê o estado atual de cada lugar (disponível, indisponível, etc.) para essa sessão específica
5. **Preços dos bilhetes** — são obtidos os preços por tipo de bilhete (Normal, IMAX, 3D, etc.) para essa sessão

Como a NOS não publica o número de bilhetes vendidos diretamente, o tracker usa o **número de lugares marcados como indisponíveis** no mapa de lugares como proxy da bilheteira, e estima a receita multiplicando esse valor pelos preços de bilhete recolhidos. Cada leitura resulta num "seat snapshot" imutável e datado, que é o que alimenta os rankings, curvas de pré-venda e previsão de receita.

O scraper inclui lógica de resiliência (retries com backoff exponencial, timeouts alargados) e validação dos dados recolhidos antes de serem guardados, para evitar snapshots inconsistentes.

### Scheduling

A recolha corre a cada 15 minutos, acionada por um **Render Cron Job** que faz `POST` autenticado ao endpoint `/api/collector/cron` do backend. O scheduler interno em Node (`setInterval`) existe como alternativa, mas vem **desativado em produção** — o Render Cron é a fonte de verdade.

---

## Instalação

**Pré-requisitos:** Node.js, Python 3.11+, PostgreSQL

```bash
git clone <repo-url>
cd portugal-box-office-tracker
npm install
pip install -r requirements.txt
cp .env.example .env   # preencher DATABASE_URL, GEMINI_API_KEY, COLLECTOR_CRON_SECRET
npm run dev
```

Build e produção:
```bash
npm run build
npm start
```

---

## Estrutura do Projeto

```
portugal-box-office-tracker/
├── server/                    # Backend Express (API, coleta, forecast, presales)
│   ├── api.ts                 # Rotas da API, incluindo /collector/cron
│   ├── collector.ts           # Orquestração das runs de recolha
│   ├── scheduler.ts           # Scheduler interno (desativado em produção)
│   ├── forecast.ts            # Previsão intraday de receita
│   └── boxoffice.ts           # Agregações de bilheteira
├── src/
│   ├── components/            # UI React (rankings, presale curve, forecast, etc.)
│   └── types.ts
├── nos_collector_job.py       # Job Python standalone de recolha (NOS Cinemas)
├── nos_scraper.py             # Scraper de sessões/lugares
└── requirements.txt
```

---

## Licença

Projeto pessoal — código disponível para consulta, uso comercial não autorizado.
