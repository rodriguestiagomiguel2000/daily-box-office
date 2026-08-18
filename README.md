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

## Recolha de Dados (Scheduling)

A recolha de dados corre a cada 15 minutos, acionada por um **Render Cron Job** que faz `POST` autenticado ao endpoint `/api/collector/cron` do backend. O scheduler interno em Node (`setInterval`) existe como alternativa, mas vem **desativado em produção** — o Render Cron é a fonte de verdade.

Existe também um workflow de GitHub Actions (`.github/workflows/nos-collector.yml`) no repositório, usado numa fase inicial do projeto como alternativa de scheduling; a versão em produção usa o Render Cron.

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
