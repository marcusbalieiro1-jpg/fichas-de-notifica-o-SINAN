# Conferência normativa do catálogo

> **Leia antes de colocar o sistema em uso assistencial.**
>
> O catálogo do HABE SINAN classifica cada agravo como **imediato (24 h)**,
> **semanal (7 dias)** ou **semanal com gatilho imediato**. Essa classificação
> orienta conduta médica. Ela foi montada a partir da Lista Nacional de
> Notificação Compulsória, mas **precisa ser conferida item a item contra a
> portaria vigente pelo Núcleo de Epidemiologia** antes do uso em produção,
> e revalidada a cada nova portaria.

## Por que a conferência é necessária

O ambiente onde este sistema foi construído não tinha acesso aos sítios do
Ministério da Saúde, então a coluna de periodicidade não pôde ser verificada
contra o texto oficial no momento da elaboração. O catálogo é uma base de
trabalho sólida e organizada — não uma fonte normativa. A responsabilidade
técnica pela classificação é do Núcleo de Epidemiologia.

## Base normativa declarada no sistema

Registrada em `assets/js/dados-fichas.js`, no bloco `revisao`, e exibida no
rodapé de todas as páginas:

> Portaria de Consolidação GM/MS nº 4/2017, Anexo 1 do Anexo V, com as
> alterações introduzidas até a Portaria GM/MS nº 11.211, de 13/05/2026.

Pontos que merecem atenção especial na conferência, por terem mudado
recentemente ou por dependerem de contexto local:

| Agravo | O que conferir |
|---|---|
| Parotidite (caxumba) | Inclusão na lista e periodicidade imediata |
| Febre do Oropouche | Quais situações disparam o prazo de 24 h |
| Difteria e Tétano | Mudança de periodicidade para imediata |
| Covid-19 / SRAG | Como a covid-19 passou a ser contemplada dentro de SRAG |
| Malária | Belém é região amazônica — confirmar fluxo e sistema (Sivep-Malária) |
| Doença invasiva por *Haemophilus influenzae* | Vigilância sentinela × notificação universal |
| Violência interpessoal | Violência sexual e tentativa de suicídio são imediatas |
| Dengue, Chikungunya, Zika, Varicela | Gatilhos de imediatidade (óbito, gestante, surto) |

## Roteiro da conferência

1. **Obtenha a lista oficial vigente** em
   <https://www.gov.br/saude/pt-br/composicao/svsa/notificacao-compulsoria>
   e o texto da portaria mais recente no Diário Oficial da União.

2. **Exporte a planilha de trabalho.** No sistema, aba **Configurações** →
   *Exportar catálogo para conferência (CSV)*. Abra no Excel: cada linha traz
   o agravo, a classificação adotada, o prazo, o gatilho e o arquivo esperado.

3. **Marque item a item** — confira, para cada agravo: consta da lista
   vigente? A periodicidade bate? O gatilho descrito está correto e completo?

4. **Corrija o catálogo.** Abra `assets/js/dados-fichas.js` e ajuste o campo
   `classificacao` (`'imediata'`, `'condicional'` ou `'semanal'`) e, quando
   for `'condicional'`, o texto de `gatilhoImediato`. O arquivo é comentado e
   não exige conhecimento de programação além de editar texto entre aspas.

5. **Acrescente o que faltar e remova o que saiu da lista**, copiando a
   estrutura de qualquer ficha existente como modelo.

6. **Registre a conferência.** No mesmo arquivo, no bloco `revisao`:

   ```js
   versao: '1.1',
   baseNormativa: 'Portaria ... (texto da portaria conferida)',
   atualizadoEm: '2026-08-20',
   conferidoPor: 'Cap Med Fulano de Tal — Chefe do Núcleo de Epidemiologia',
   conferidoEm: '2026-08-20'
   ```

   Preenchendo `conferidoPor`, o aviso de "conferência pendente" desaparece
   das Configurações, e o crédito passa a constar no sistema.

7. **Publique**: `git add . && git commit -m "Conferência normativa" &&
   git push`. Os computadores recebem a atualização ao recarregar a página.

## Sempre que sair portaria nova

Repita os passos 1 a 7 e incremente a `versao`. Vale também revisar os PDFs do
acervo (`fichas/`), já que revisões de ficha costumam acompanhar mudanças na
lista.
