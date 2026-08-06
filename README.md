# HABE SINAN

Diretório de fichas de notificação compulsória do SINAN do **Hospital de
Aeronáutica de Belém**, com registro das solicitações, anexo das fichas
digitalizadas e relatórios para o Núcleo de Epidemiologia.

Acesso por **QR Code** (celular) e por **atalho na área de trabalho** dos
computadores de atendimento. Sem instalação e sem login.

---

## O que o sistema faz

**Para o médico assistente**

- Sumário de **69 agravos em ordem alfabética**, com destaque visual
  inconfundível entre notificação **imediata (24 h)**, **semanal (7 dias)** e
  **semanal com gatilho imediato**.
- Busca por nome, sinônimo popular (*catapora*, *calazar*) ou CID-10.
- Solicitação em um minuto: agravo, data do atendimento, nome completo do
  paciente, prontuário e destino (domicílio, UI1, UI2 ou UTI).
- **Download automático da ficha correta**, já renomeada
  (`FICHA_DENGUE_PRONT-2026-04471_2026-08-06.pdf`).
- Comprovante com número de protocolo, pronto para imprimir e anexar à ficha.

**Para o Núcleo de Epidemiologia**

- Painel de todas as solicitações, com filtros por período, prazo, agravo,
  médico, destino e situação; contador de pendências no menu.
- **Anexo da ficha preenchida e digitalizada** — PDF ou foto legível, com
  compressão automática das fotos.
- Relatórios por mês de competência, **semana epidemiológica**, agravo,
  grupo, prazo, destino e médico; exportação em CSV para o Excel.
- Cadastro breve dos médicos solicitantes, com histórico por profissional.
- Geração do QR Code, do cartaz A4 e do atalho `.url` para as máquinas.

---

## Experimentando

O jeito mais rápido: baixe **[`HABE-SINAN.html`](HABE-SINAN.html)** — todo o
sistema num arquivo só, com o CSS, os scripts e o brasão embutidos — e abra com
dois cliques. Não precisa instalar nada, servidor nem internet.

A partir do código:

```bash
git clone https://github.com/marcusbalieiro1-jpg/fichas-de-notifica-o-SINAN.git
cd fichas-de-notifica-o-SINAN
python3 -m http.server 8000      # ou: npx http-server -p 8000
```

Abra <http://localhost:8000>.

> Para **testar**, use nomes fictícios de paciente. Enquanto o sistema não
> estiver na intranet do hospital, dado real de paciente não deve ser digitado.

Para publicar e distribuir de verdade, siga **[docs/IMPLANTACAO.md](docs/IMPLANTACAO.md)**.

### Regerando o arquivo único

`HABE-SINAN.html` é uma cópia congelada: não acompanha as alterações sozinho.
Depois de mexer no catálogo, no CSS ou em qualquer script:

```bash
node scripts/gerar-arquivo-unico.js
```

---

## Antes de usar em produção

Três passos, nesta ordem:

1. **[Conferir a classificação dos prazos](docs/CONFERENCIA-NORMATIVA.md)** —
   obrigatório. A coluna imediata/semanal orienta conduta médica e precisa ser
   validada pelo Núcleo de Epidemiologia contra a portaria vigente.
2. **[Preencher o acervo de fichas](fichas/README.md)** — enquanto a pasta
   `fichas/` estiver vazia, o sistema abre o portal do Ministério da Saúde em
   vez de entregar o PDF renomeado.
3. **[Ligar o modo compartilhado](backend/apps-script/README.md)** — para que
   todos os computadores enxerguem as mesmas solicitações.

O brasão do HABE em `assets/img/logo-habe.svg` é um **redesenho vetorial** do
emblema institucional — nítido em qualquer tamanho, do ícone de 52 px ao
cartaz A4. Para usar o arquivo original em vez do redesenho, salve-o como
`assets/img/logo-habe.png` e troque a extensão nas quatro referências
(`index.html`, `assets/js/app.js`, `assets/js/paginas/acesso.js` e
`assets/js/paginas/solicitar.js`). O CSS já preserva a proporção do brasão.

---

## Como está organizado

```
index.html                      página única do sistema
assets/
  css/estilo.css                identidade visual, tema claro/escuro, impressão
  img/logo-habe.svg             brasão do HABE, redesenhado em vetor
  js/
    dados-fichas.js             ► CATÁLOGO — o único arquivo a manter em dia
    armazenamento.js            modo local (navegador) e compartilhado (Google)
    qrcode.js                   gerador de QR Code próprio, sem dependências
    util.js                     datas, semana epidemiológica, downloads, CSV
    app.js                      navegação entre páginas e trava por PIN
    paginas/                    início, fichas, solicitar, solicitações,
                                relatórios, médicos, acesso rápido, config
backend/apps-script/            servidor opcional (planilha Google + Drive)
fichas/                         acervo de PDFs entregues por download
scripts/
  descobrir-fichas.js           acha os links das fichas no portal do Sinan
  baixar-fichas.js              popula o acervo a partir dos links oficiais
  gerar-arquivo-unico.js        monta o HABE-SINAN.html de arquivo único
HABE-SINAN.html                 o sistema inteiro num arquivo, para dois cliques
docs/                           implantação, conferência normativa, guia médico
```

Sem etapa de compilação, sem dependências externas, sem CDN: HTML, CSS e
JavaScript puros. O QR Code é gerado por implementação própria do padrão
ISO/IEC 18004, então o sistema funciona com o computador desconectado.

### Manutenção do dia a dia

Quase tudo se resolve em **`assets/js/dados-fichas.js`**: acrescentar um
agravo, corrigir um prazo, ajustar um gatilho ou trocar o link oficial. O
arquivo é comentado e não exige mais do que editar texto entre aspas.

---

## Dados de pacientes

O sistema registra nome completo, prontuário e agravo — dados pessoais
sensíveis de saúde, sujeitos à LGPD e ao sigilo profissional. As
recomendações de hospedagem, restrição de acesso, PIN, backup e descarte
estão na seção 9 de [docs/IMPLANTACAO.md](docs/IMPLANTACAO.md).

O PIN da área do Núcleo é uma barreira de conveniência — evita abertura por
engano num computador de consultório —, **não** um controle de acesso
corporativo.

---

## Documentação

| Documento | Para quem |
|---|---|
| [docs/IMPLANTACAO.md](docs/IMPLANTACAO.md) | Quem vai publicar e distribuir |
| [docs/CONFERENCIA-NORMATIVA.md](docs/CONFERENCIA-NORMATIVA.md) | Chefia do Núcleo de Epidemiologia |
| [docs/MANUAL-MEDICO.md](docs/MANUAL-MEDICO.md) | Médicos assistentes (uma página, para imprimir) |
| [backend/apps-script/README.md](backend/apps-script/README.md) | Quem vai ligar o modo compartilhado |
| [fichas/README.md](fichas/README.md) | Quem vai manter o acervo de PDFs |
