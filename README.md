# HABE SINAN

> **Também neste repositório: [HABE · AQS e NSP — Ferramenta de Gestão de
> Atividades](aqs-nsp/README.md).** Sistema da Assessoria de Qualidade e
> Segurança e do Núcleo de Segurança do Paciente para as missões da equipe
> (prazos, evidências, avisos, relatórios e o plano de atividades), com
> login, banco de dados no Supabase e uso no celular. Fica inteiro na pasta
> [`aqs-nsp/`](aqs-nsp/) e é independente do SINAN descrito abaixo:
> [manual](aqs-nsp/docs/MANUAL.md) ·
> [implantação](aqs-nsp/docs/IMPLANTACAO.md) ·
> [continuidade](aqs-nsp/docs/CONTINUIDADE.md) ·
> [demonstração](aqs-nsp/demo.html).
>
> **Como testar agora (sem instalar nada):** abra a demonstração em
> <https://marcusbalieiro1-jpg.github.io/fichas-de-notifica-o-SINAN/aqs-nsp/demo.html>
> — no computador ou no celular — e escolha um perfil em "Entrar como…".
> Os dados são fictícios e nada é gravado em servidor. (O link funciona
> depois que o GitHub Pages estiver ativado em *Settings → Pages*, branch
> padrão, pasta raiz.) A versão com login real só existe depois da
> [implantação](aqs-nsp/docs/IMPLANTACAO.md).

Diretório de fichas de notificação compulsória do SINAN do **Hospital de
Aeronáutica de Belém**, com registro das solicitações, anexo das fichas
digitalizadas e relatórios para o Núcleo de Epidemiologia.

Acesso por **QR Code** (celular) e por **atalho na área de trabalho** dos
computadores de atendimento. Sem instalação e sem login.

---

## Duas páginas, dois públicos

O sistema é composto por **duas páginas separadas**, e essa separação é
deliberada: a que circula pelos consultórios não contém uma linha sequer de
código que lide com dado de paciente.

### `index.html` — consulta (urgência e ambulatórios)

Para o médico assistente, no atendimento. Faz uma coisa só, e bem:

- Sumário dos **69 agravos em ordem alfabética**, com distinção visual
  inconfundível entre **imediata (24 h)**, **semanal (7 dias)** e **semanal
  com gatilho imediato**.
- Busca por nome, sinônimo popular (*catapora*, *calazar*) ou CID-10.
- **Download da ficha** em um clique, sem preencher nada.
- Aba *Como notificar*: os cinco passos e o contato do Núcleo. Em agravo
  vermelho, a orientação de ligar antes de qualquer papel.

Não registra, não guarda e não carrega a camada de armazenamento — apenas
quatro scripts. É esta que vai no QR Code e nos atalhos dos consultórios.

### `nucleo.html` — registro (Núcleo Hospitalar de Epidemiologia)

Para o chefe do Núcleo, que alimenta o sistema manualmente a partir das
fichas recebidas:

- **Registro da notificação**: agravo, data do atendimento, data de chegada
  ao Núcleo, paciente, prontuário, destino (domicílio, UI1, UI2, UTI) e médico
  notificante. O sistema avisa na hora se o prazo foi cumprido.
- **Anexo da ficha digitalizada** — PDF ou foto, com compressão automática.
- **Relatórios** por mês, semana epidemiológica, agravo, grupo, prazo, destino
  e médico, com o indicador de **oportunidade da notificação** e exportação CSV.
- Painel com pendências e alerta de prazos vencidos sem ficha anexada.
- Cadastro dos médicos notificantes.
- Geração do QR Code, do cartaz A4 e do atalho `.url` — sempre apontando para
  a página de consulta, nunca para esta.

Contém dados pessoais sensíveis: fica em pasta restrita e o endereço não se
divulga.

---

## Experimentando

Baixe **[`HABE-SINAN-consulta.html`](HABE-SINAN-consulta.html)** ou
**[`HABE-SINAN-nucleo.html`](HABE-SINAN-nucleo.html)** — cada um traz o CSS, os
scripts e o brasão embutidos num arquivo só — e abra com dois cliques.

A partir do código:

```bash
git clone https://github.com/marcusbalieiro1-jpg/fichas-de-notifica-o-SINAN.git
cd fichas-de-notifica-o-SINAN
python3 -m http.server 8000      # ou: npx http-server -p 8000
```

`http://localhost:8000/` abre a consulta; `.../nucleo.html`, o Núcleo.

> Para **testar**, use nomes fictícios de paciente. Enquanto o sistema não
> estiver na intranet do hospital, dado real não deve ser digitado.

### Regerando os arquivos únicos

São cópias congeladas: não acompanham as alterações sozinhas.

```bash
node scripts/gerar-arquivo-unico.js
```

---

## Antes de usar em produção

Quatro passos, nesta ordem:

1. **Preencher o contato do Núcleo** em `assets/js/dados-fichas.js`, no bloco
   `unidade`: ramal e telefone de plantão. Sem isso a página dos médicos manda
   ligar para o Núcleo sem dizer para onde.
2. **[Conferir a classificação dos prazos](docs/CONFERENCIA-NORMATIVA.md)** —
   obrigatório. A coluna imediata/semanal orienta conduta médica e precisa ser
   validada pelo Núcleo de Epidemiologia contra a portaria vigente.
3. **[Preencher o acervo de fichas](fichas/README.md)** — enquanto a pasta
   `fichas/` estiver vazia, o sistema abre o portal do Ministério da Saúde em
   vez de entregar o PDF renomeado.
4. **[Ligar o modo compartilhado](backend/apps-script/README.md)** — para que
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
index.html                      ► página de CONSULTA (médicos assistentes)
nucleo.html                     ► página do NÚCLEO (registro e relatórios)
assets/
  css/estilo.css                identidade visual, tema claro/escuro, impressão
  img/logo-habe.svg             brasão do HABE, redesenhado em vetor
  js/
    dados-fichas.js             ► CATÁLOGO — o único arquivo a manter em dia
    armazenamento.js            modo local (navegador) e compartilhado (Google)
    qrcode.js                   gerador de QR Code próprio, sem dependências
    util.js                     datas, semana epidemiológica, downloads, CSV
    consulta.js                 navegação da página de consulta
    app.js                      navegação da página do Núcleo e trava por PIN
    paginas/
      fichas.js                 sumário A–Z (usado pelas duas páginas)
      painel.js                 painel do Núcleo
      registrar.js              registro manual das notificações
      notificacoes.js           lista, anexos e situação
      relatorios.js             levantamentos e oportunidade
      medicos.js, acesso.js, config.js
backend/apps-script/            servidor opcional (planilha Google + Drive)
fichas/                         acervo de PDFs entregues por download
scripts/
  descobrir-fichas.js           acha os links das fichas no portal do Sinan
  baixar-fichas.js              popula o acervo a partir dos links oficiais
  gerar-arquivo-unico.js        monta o HABE-SINAN.html de arquivo único
HABE-SINAN-consulta.html        a página dos médicos, num arquivo só
HABE-SINAN-nucleo.html          a página do Núcleo, num arquivo só
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
| [docs/TRANSPORTE-E-INTRANET.md](docs/TRANSPORTE-E-INTRANET.md) | Quem vai levar o projeto para a rede interna do hospital |
| [docs/CONFERENCIA-NORMATIVA.md](docs/CONFERENCIA-NORMATIVA.md) | Chefia do Núcleo de Epidemiologia |
| [docs/MANUAL-MEDICO.md](docs/MANUAL-MEDICO.md) | Médicos assistentes (uma página, para imprimir) |
| [backend/apps-script/README.md](backend/apps-script/README.md) | Quem vai ligar o modo compartilhado |
| [fichas/README.md](fichas/README.md) | Quem vai manter o acervo de PDFs |
