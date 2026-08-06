# Modo compartilhado — planilha Google + Google Drive

No modo padrão, cada computador guarda seus próprios dados. Para que **todos
os computadores enxerguem as mesmas solicitações** e os anexos fiquem num
lugar só, publique o servidor descrito aqui. É gratuito, não exige máquina
dedicada e leva cerca de dez minutos.

O que ele faz:

- grava as solicitações e o cadastro de médicos numa **planilha Google**;
- guarda as fichas digitalizadas numa pasta do **Google Drive**;
- numera os protocolos de forma sequencial e sem colisão entre computadores.

---

## Passo a passo

### 1. Crie a planilha

1. Em <https://drive.google.com>, crie uma **Planilha Google** chamada
   `HABE SINAN — Base`.
2. Use uma conta institucional do hospital, não uma conta pessoal.

### 2. Abra o editor de scripts

Na planilha: **Extensões → Apps Script**.

### 3. Cole o código

1. Apague o conteúdo de `Código.gs`.
2. Cole todo o conteúdo de [`Codigo.gs`](Codigo.gs) deste repositório.
3. No topo do arquivo, troque a constante `CHAVE` por um valor longo e
   aleatório — ele funciona como senha entre o sistema e o servidor:

   ```js
   var CHAVE = 'habe-2026-K7mZq3Xr9TpL2vWn8Ys4Bd6Hc1Gf5Jk';
   ```

   Guarde esse valor: será pedido nas Configurações do HABE SINAN.

4. Salve (💾).

### 4. Prepare as abas e a pasta

No editor, escolha a função **`prepararPlanilha`** na lista suspensa e clique
em **Executar**. O Google pedirá autorização na primeira vez:

- **Revisar permissões** → escolha a conta → **Avançado** →
  **Acessar HABE SINAN (não seguro)** → **Permitir**.

O aviso aparece porque o script é seu e não passou por revisão do Google; ele
só acessa a própria planilha e a pasta de anexos.

Ao final, a planilha terá as abas `Solicitacoes`, `Medicos` e `Sequencia`, e o
Drive terá a pasta `HABE SINAN - Anexos`.

### 5. Publique o Web App

1. **Implantar → Nova implantação**.
2. No ícone de engrenagem, escolha **App da Web**.
3. Preencha:
   - **Descrição:** `HABE SINAN`
   - **Executar como:** `Eu` (a conta dona da planilha)
   - **Quem pode acessar:** `Qualquer pessoa`
4. **Implantar** e copie a **URL do app da Web** — termina em `/exec`.

> **Sobre "Qualquer pessoa":** é o que permite que os navegadores dos
> consultórios conversem com o script sem login do Google em cada máquina. A
> proteção passa a ser a constante `CHAVE`: sem ela, o servidor recusa toda
> requisição. Por isso a chave precisa ser longa e não pode circular fora do
> Núcleo. Se a política do hospital exigir mais que isso, prefira hospedar o
> sistema na intranet com autenticação de rede.

### 6. Ligue o sistema ao servidor

No HABE SINAN, aba **Configurações**:

1. Marque **Compartilhado (planilha Google + Drive)**.
2. Cole a URL terminada em `/exec`.
3. Informe a mesma `CHAVE`.
4. **Testar conexão** → deve responder `✓ Conectado`.
5. **Salvar configurações**.

Repita em cada computador de atendimento — são três campos, uma vez só por
máquina.

### 7. Restrinja o acesso à planilha

Na planilha, **Compartilhar**: mantenha o acesso restrito às contas do Núcleo
de Epidemiologia. Faça o mesmo com a pasta `HABE SINAN - Anexos`. O sistema
continua funcionando porque o script executa com a permissão da conta dona.

---

## Depois de alterar o código

Toda mudança em `Codigo.gs` exige **Implantar → Gerenciar implantações →
✏️ Editar → Versão: Nova versão → Implantar**. A URL não muda.

---

## Problemas comuns

| Sintoma | Causa provável |
|---|---|
| `Chave compartilhada incorreta` | A chave nas Configurações difere da constante `CHAVE` |
| `Falha na comunicação com o servidor` | URL não termina em `/exec`, ou a implantação não foi atualizada |
| Funciona num computador e falha em outro | O outro ainda está no modo local, ou com chave diferente |
| `Autorização necessária` no log | Rode `prepararPlanilha` manualmente e autorize |
| Anexo grande não sobe | Reduza o limite em Configurações; fotos já são comprimidas automaticamente |

## Limites do Google (contas gratuitas)

- Tempo de execução: 6 minutos por requisição — folgado para este uso.
- Tráfego do Apps Script: cerca de 50 MB por requisição.
- Cota diária de execução: suficiente para milhares de solicitações por dia.

## Voltar ao modo local

Em **Configurações**, marque *Somente neste computador*. Os dados que já estão
na planilha continuam lá; o computador apenas deixa de consultá-la. Exporte um
backup antes se quiser levar o histórico junto.
