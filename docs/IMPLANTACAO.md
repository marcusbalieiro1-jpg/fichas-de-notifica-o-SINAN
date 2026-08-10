# Guia de implantação

Roteiro completo para colocar o HABE SINAN no ar e distribuí-lo pelos
computadores de atendimento.

---

## 1. Publicar o sistema e obter o link

O sistema é um site estático: não precisa de servidor de aplicação, banco de
dados nem instalação nos computadores.

### Opção A — GitHub Pages (recomendada para começar)

1. No GitHub, abra o repositório → **Settings** → **Pages**.
2. Em *Build and deployment*, escolha **Deploy from a branch**.
3. Selecione a branch (`main`, ou a branch de desenvolvimento) e a pasta
   **/ (root)**. Salve.
4. Após um ou dois minutos, o endereço aparece na própria página:

   ```
   https://<usuário>.github.io/<repositório>/
   ```

   **Esse é o link** para o QR Code e para os atalhos.

> **Atenção ao sigilo:** um repositório público deixa o *código* visível a
> qualquer pessoa — nunca os dados de pacientes, que ficam no navegador ou na
> planilha privada. Ainda assim, o ideal é usar repositório **privado** com
> GitHub Pages restrito, ou hospedar internamente (opção B).

### Opção B — servidor interno do hospital (mais adequado a dados de saúde)

Copie a pasta do projeto para qualquer servidor web da intranet (IIS, Apache,
Nginx). Não há etapa de compilação: publique os arquivos como estão. O
endereço fica algo como `http://intranet.habe/sinan/`. Vantagens: funciona sem
internet e o tráfego não sai da rede do hospital.

### Opção C — pasta de rede compartilhada

Copie o projeto para uma pasta compartilhada e abra o `index.html` pelo
Windows Explorer (ou `nucleo.html`, no computador do Núcleo). Funciona (o sistema não usa módulos que exijam servidor),
mas cada computador terá seus próprios dados, salvo no modo compartilhado.

---

## 2. Preencher o acervo de fichas

Sem isso o sistema abre o portal do Ministério da Saúde em vez de entregar o
PDF renomeado. Veja `fichas/README.md` — em resumo:

```bash
node scripts/baixar-fichas.js --listar   # o que falta
node scripts/baixar-fichas.js            # baixa o que tem link cadastrado
```

O restante é baixado manualmente do portal do Sinan e salvo em `fichas/` com o
nome indicado na listagem.

---

## 3. Conferir a classificação dos prazos

**Passo obrigatório antes do uso assistencial.** Siga
`docs/CONFERENCIA-NORMATIVA.md`.

---

## 4. Escolher onde os dados ficam gravados

Abra **Configurações** no sistema.

### Modo local (padrão)

Os dados ficam no navegador de cada computador. Não exige nada além do link.
Serve para teste, para um posto único e como contingência quando a rede cai.
**Limitação:** o Núcleo de Epidemiologia só vê o que foi registrado naquele
mesmo computador e naquele mesmo navegador.

### Modo compartilhado (recomendado em produção)

Todos os computadores enxergam os mesmos registros, e os anexos vão para
uma pasta do Google Drive. Siga `backend/apps-script/README.md`: são cerca de
dez minutos de configuração, sem custo.

Depois de publicar o Web App, volte a **Configurações**, marque
*Compartilhado*, cole o endereço que termina em `/exec`, informe a mesma chave
definida no script e clique em **Testar conexão**.

---

## 5. Ajustar identificação e PIN

Ainda em **Configurações**:

- **Endereço público**: cole o link da **página de consulta** (`index.html`)
  do passo 1, para fixá-lo no QR Code e no atalho.
- **PIN do Núcleo**: se preenchido, a página `nucleo.html` inteira passa a
  exigi-lo. A página de consulta continua aberta — ela não tem o que proteger.

A unidade, o setor e o contato do Núcleo não ficam aqui: estão em
`assets/js/dados-fichas.js`, no bloco `unidade`, para valerem igualmente nas
duas páginas e em todos os computadores.

> O PIN é uma barreira de conveniência: evita abertura por engano num
> computador de consultório. Ele **não** é criptografia nem controle de acesso
> corporativo. A proteção real dos dados depende do controle de acesso da rede
> do hospital e das permissões da planilha compartilhada.

---

## 6. Distribuir o acesso

Abra a aba **Acesso rápido**.

### QR Code nos consultórios

O QR sempre aponta para a **página de consulta**. O endereço da página do
Núcleo não entra em cartaz nem em atalho de consultório.

1. Confira o endereço no campo do topo.
2. **Imprimir cartaz** → papel A4. O cartaz já traz o QR, o endereço por
   extenso e a explicação dos dois prazos de notificação.
3. Afixe no pronto atendimento, nos consultórios, na UI1, na UI2 e na UTI.
4. Teste a leitura a cerca de 40 cm antes de reproduzir em série. Evite
   plastificado muito reflexivo.

Para usar a imagem em outros materiais, use **Baixar QR Code (PNG)**.

### Atalho na área de trabalho

1. **Baixar atalho para a área de trabalho** gera o arquivo `HABE SINAN.url`.
2. Mova-o para a Área de Trabalho.
3. Para todos os perfis do computador, cole em `C:\Users\Public\Desktop`
   (requer perfil administrador).
4. Opcional: botão direito → **Propriedades** → **Alterar ícone**.

Para implantar em muitas máquinas de uma vez, distribua o `.url` por script de
logon ou por diretiva de grupo (GPO), copiando-o para a área de trabalho
pública.

### Fixar no navegador

Nos computadores de atendimento, vale abrir o link e usar
**⋮ → Salvar e compartilhar → Criar atalho** (Chrome/Edge), marcando *Abrir
como janela*: o sistema passa a se comportar como um aplicativo próprio.

---

## 7. Rotina de trabalho

**Médico**, no atendimento (página `index.html`):

1. Abre pelo QR Code ou pelo atalho.
2. Busca o agravo e confere a cor: ⏱ vermelho = 24 h.
3. Em agravo imediato, **liga para o Núcleo na hora** — antes de qualquer papel.
4. Baixa a ficha, preenche, assina e encaminha ao Núcleo.

**Núcleo de Epidemiologia** (página `nucleo.html`):

1. Recebe a ficha preenchida e lança em **Registrar notificação**, informando
   também a data em que ela chegou — é o que mede a oportunidade.
2. Digitaliza (PDF ou foto legível) e anexa ao protocolo.
3. Marca a situação como **Encerrada** depois de lançar no Sinan.
4. **Relatórios** → levantamento por mês, semana epidemiológica, agravo,
   prazo, destino e médico, com o percentual de notificações no prazo.

---

## 8. Cópia de segurança

No **modo local**, os dados vivem apenas no navegador: limpar o histórico
apaga tudo. Exporte um backup semanalmente em **Configurações → Exportar
backup (JSON)** e guarde em pasta de rede.

No **modo compartilhado**, a própria planilha Google é a base; ative o
histórico de versões e faça cópia periódica da planilha e da pasta de anexos.

---

## 9. Proteção de dados

O sistema registra nome completo, prontuário e agravo — dados pessoais
sensíveis de saúde, sob a Lei Geral de Proteção de Dados e o sigilo
profissional. Recomendações mínimas:

- Prefira hospedagem interna ou repositório privado.
- No modo compartilhado, restrinja a planilha e a pasta do Drive às contas do
  Núcleo de Epidemiologia; não use link "qualquer pessoa com o link".
- Configure o PIN e mantenha o bloqueio de tela nos computadores de consultório.
- Defina com a chefia por quanto tempo os registros ficam no sistema e faça o
  descarte no prazo combinado.
- Registre o tratamento no inventário de dados pessoais da unidade.
