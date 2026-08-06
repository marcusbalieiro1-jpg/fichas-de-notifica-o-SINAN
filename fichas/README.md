# Acervo local de fichas

Esta pasta guarda os PDFs das fichas de notificação que o HABE SINAN entrega
por download automático ao médico solicitante.

## Como o sistema decide o que entregar

1. Procura o arquivo declarado no campo `arquivo` do catálogo
   (`assets/js/dados-fichas.js`) — por exemplo, `fichas/dengue-chikungunya.pdf`.
2. Encontrando, baixa o PDF já renomeado com o agravo, o prontuário e a data
   do atendimento: `FICHA_DENGUE_PRONT-2026-04471_2026-08-06.pdf`.
3. Não encontrando, abre a versão oficial no portal do Ministério da Saúde e
   avisa, no comprovante, que a ficha ainda não está no acervo local.

Ou seja: **enquanto esta pasta estiver vazia, o sistema funciona, mas depende
da internet e não entrega o arquivo renomeado.** Preencher o acervo é o passo
que torna o download instantâneo e o deixa disponível mesmo com a rede
externa fora do ar.

## Como preencher

**Com Node.js instalado** (jeito rápido, a partir da raiz do projeto):

```bash
node scripts/baixar-fichas.js --listar    # mostra o que falta
node scripts/descobrir-fichas.js          # procura os links no portal do Sinan
                                          # e propõe qual PDF é de qual agravo
node scripts/descobrir-fichas.js --aplicar   # grava as propostas de confiança alta
node scripts/baixar-fichas.js             # baixa tudo o que tiver link cadastrado
```

O `descobrir-fichas.js` varre o portal do Ministério da Saúde e escreve as
propostas em `fichas/PROPOSTAS-DE-LINKS.md`, **sem gravar nada por conta
própria**: entregar a ficha errada ao médico é pior do que não entregar ficha
nenhuma. Confira o relatório antes de rodar com `--aplicar`, que só grava as
propostas de confiança alta e nunca sobrescreve link já existente.

**Manualmente** (jeito garantido):

1. Abra <https://portalsinan.saude.gov.br/notificacoes>.
2. Baixe o PDF da ficha de notificação/investigação do agravo.
3. Salve nesta pasta **com exatamente o nome esperado**. A lista completa,
   com caixas para ir marcando, está em
   [LISTA-DE-ARQUIVOS.md](LISTA-DE-ARQUIVOS.md) — dá para abrir direto no
   GitHub. Ela também sai por `node scripts/baixar-fichas.js --listar` e pelo
   botão *Exportar catálogo para conferência (CSV)* na aba **Configurações**.

Depois de copiar os arquivos, faça `git add fichas/ && git commit && git push`
para que todos os computadores recebam o acervo.

## Regras de nomeação

- Sempre minúsculas, sem acento e sem espaço, separando palavras por hífen.
- Um mesmo arquivo pode atender a vários agravos: `dengue-chikungunya.pdf`
  serve tanto a Dengue quanto a Chikungunya, e `doencas-exantematicas.pdf`
  atende Sarampo e Rubéola. Basta apontar o mesmo caminho no catálogo.
- Se precisar acrescentar um agravo novo, edite `assets/js/dados-fichas.js`
  e coloque o PDF aqui com o nome declarado.

## Atualização periódica

O Ministério da Saúde revisa as fichas. Vale conferir a cada semestre, ou
sempre que sair portaria nova, se a versão do acervo continua sendo a vigente.
Registre a data da última conferência em `docs/CONFERENCIA-NORMATIVA.md`.
