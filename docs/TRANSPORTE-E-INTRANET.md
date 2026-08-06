# Levar o projeto para a intranet

Roteiro para copiar o HABE SINAN num HD externo ou pen drive, transportá-lo até
um computador da rede do hospital e instalá-lo numa pasta segura — sem depender
de internet no destino.

---

## 1. O que levar

O projeto inteiro cabe em cerca de 1 MB. Copie a pasta completa, não apenas o
`HABE-SINAN.html`: é a pasta que permite atualizar o catálogo, guardar as
fichas em PDF e gerar o arquivo único de novo depois de qualquer mudança.

```
HABE-SINAN/
├── HABE-SINAN.html          o sistema num arquivo só (dois cliques)
├── index.html               a mesma coisa, servida em pedaços
├── assets/                  estilo, brasão e scripts
├── fichas/                  acervo de PDFs (a preencher)
├── backend/apps-script/     servidor opcional
├── docs/                    manuais
├── scripts/                 utilitários de manutenção
└── .git/                    histórico de versões (opcional)
```

Guarde junto o `CONFERENCIA.txt` que acompanha o pacote: é com ele que se
verifica se a cópia chegou íntegra.

---

## 2. Copiar para o HD externo

**Do pacote `.zip`** — descompacte direto no HD externo. No Windows, evite
executar a partir de dentro do `.zip`: descompacte primeiro, senão o navegador
abre os arquivos numa pasta temporária e o acervo de fichas não é encontrado.

**Do repositório**, se o computador tiver Git e acesso ao GitHub:

```bash
git clone https://github.com/marcusbalieiro1-jpg/fichas-de-notifica-o-SINAN.git E:\HABE-SINAN
```

Clonar preserva o histórico e permite receber atualizações depois com
`git pull`. O pacote `.zip` é mais simples e não exige nada instalado — os dois
chegam ao mesmo resultado.

---

## 3. Conferir a integridade da cópia

Antes de desconectar o HD, confirme que nada se corrompeu no caminho.

**Windows (PowerShell), na pasta copiada:**

```powershell
Get-FileHash HABE-SINAN.html -Algorithm SHA256
```

**Linux ou macOS:**

```bash
shasum -a 256 HABE-SINAN.html
```

Compare com a linha correspondente do `CONFERENCIA.txt`. Se bater, a cópia
está fiel. Se não bater, copie de novo — não instale um arquivo divergente.

---

## 4. Instalar na intranet

Escolha o nível conforme o que a unidade precisa.

### Nível A — pasta compartilhada, sem servidor

O mais rápido de montar. Copie a pasta para um compartilhamento de rede e
distribua um atalho para `HABE-SINAN.html`.

```
\\servidor-habe\Aplicativos\HABE-SINAN\
```

Funciona sem servidor web e sem internet. **Limitação séria:** cada computador
guarda os próprios dados no navegador. O médico registra a solicitação na
máquina dele, e o Núcleo **não** enxerga esse registro de outra máquina. Serve
para consulta das fichas e para um posto único — não para o controle
centralizado das solicitações.

### Nível B — servidor web interno

Sirva a pasta por um servidor web já existente na rede (IIS, Apache ou Nginx).
O sistema é estático: não há o que compilar, instalar ou configurar no servidor
além de apontar um diretório.

**IIS (Windows Server):** Gerenciador do IIS → *Sites* → **Adicionar site** →
aponte o caminho físico para a pasta, defina o nome do host e a porta. Garanta
que `.html`, `.js`, `.css`, `.svg` e `.pdf` estejam nos tipos MIME (todos são
padrão).

**Apache** — em `httpd.conf` ou num arquivo de `sites-available`:

```apache
Alias /sinan "C:/Aplicativos/HABE-SINAN"
<Directory "C:/Aplicativos/HABE-SINAN">
    Require ip 10.0.0.0/8      # restrinja à faixa da rede do hospital
    Options -Indexes
</Directory>
```

O endereço fica `http://intranet.habe/sinan/`. Esse é o link que vai no QR Code
e nos atalhos — gere-os na aba **Acesso rápido** depois de instalar, com o
endereço novo no campo do topo.

Vantagens sobre o nível A: um endereço único, atualização num lugar só, QR Code
que funciona no celular dentro da rede, e a listagem de diretório desligada.

### Nível C — com dados compartilhados entre os computadores

**Leia antes de planejar:** o modo compartilhado que já vem pronto usa uma
planilha Google e o Google Drive, e **por isso exige internet**. Numa intranet
isolada ele não funciona.

Para o Núcleo enxergar, de um computador só, tudo o que os médicos registram
numa rede sem internet, é preciso um serviço de dados rodando dentro da própria
rede. A camada de armazenamento do sistema (`assets/js/armazenamento.js`) foi
escrita justamente para isso: trocar o destino dos dados não mexe em nenhuma
tela. Fale com quem estiver mantendo o projeto antes de fechar o desenho da
rede — é a única peça que ainda não existe.

---

## 5. A pasta segura

O sistema registra nome completo, prontuário e agravo: dado pessoal sensível de
saúde. A proteção real vem do sistema de arquivos e da rede, não do PIN da
aplicação.

**Permissões sugeridas no Windows (NTFS), com dois grupos do domínio:**

| Grupo | Permissão | Por quê |
|---|---|---|
| `HABE-Medicos` | Leitura e execução | Abrem o sistema e baixam fichas; não alteram nada |
| `HABE-Epidemiologia` | Modificação | Atualizam o catálogo e o acervo de fichas |
| `Todos` / `Usuários` | *removido* | Herança desativada, sem acesso implícito |

Desative a herança de permissões na pasta raiz antes de aplicar os grupos,
senão as permissões do volume voltam por baixo.

Complementos que valem a pena:

- **BitLocker** no volume, se a máquina puder ser levada ou furtada.
- **Restrição por faixa de IP** no servidor web, limitando à rede do hospital.
- **Bloqueio de tela** nos computadores de consultório — mais eficaz que o PIN
  da aplicação, que é barreira de conveniência, não controle de acesso.
- **Registro no inventário de dados pessoais** da unidade, com o prazo de
  guarda combinado com a chefia.

---

## 6. Depois de instalar

1. Abra o sistema pelo endereço definitivo.
2. **Configurações** → confirme unidade e setor, cole o endereço da intranet em
   *Endereço público* e defina o PIN do Núcleo.
3. **Acesso rápido** → gere o QR Code com o endereço novo, imprima o cartaz e
   baixe o atalho `.url` para as máquinas de atendimento.
4. Preencha `fichas/` com os PDFs (ver [`../fichas/README.md`](../fichas/README.md)).
5. Faça a conferência normativa (ver [`CONFERENCIA-NORMATIVA.md`](CONFERENCIA-NORMATIVA.md)).
6. Distribua o [`MANUAL-MEDICO.md`](MANUAL-MEDICO.md) impresso aos consultórios.

---

## 7. Atualizações depois da instalação

**Alterou o catálogo, o estilo ou algum script?** Gere o arquivo único de novo,
senão o `HABE-SINAN.html` continua mostrando a versão antiga:

```bash
node scripts/gerar-arquivo-unico.js
```

**Levando uma versão nova de fora:** copie a pasta inteira por cima, exceto
`fichas/`, se o acervo já tiver sido preenchido no destino. Confira o hash
antes de substituir.

**Com Git no destino:** `git pull` resolve tudo de uma vez, quando houver
acesso ao repositório.

---

## 8. Conferência final

- [ ] Pasta copiada e hash conferido contra o `CONFERENCIA.txt`
- [ ] Sistema abre pelo endereço da intranet, em mais de um computador
- [ ] Permissões da pasta aplicadas, com herança desativada
- [ ] Listagem de diretório desligada no servidor web
- [ ] Unidade, setor, endereço público e PIN configurados
- [ ] QR Code impresso e testado com o celular dentro da rede
- [ ] Atalho na área de trabalho dos computadores de atendimento
- [ ] Acervo `fichas/` preenchido
- [ ] Conferência normativa assinada
- [ ] Decidido como os dados serão compartilhados (níveis A, B ou C)
- [ ] Rotina de cópia de segurança combinada
