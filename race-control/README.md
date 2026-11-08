# Rookie League Race Control — MVP (Assetto Corsa original)

Protótipo para **avisos de bandeira vermelha e VSC** no Assetto Corsa original (Content Manager/CSP compatíveis). Esta versão **não** altera o estado nativo do servidor, não pausa sessões, não impõe velocidade, não bloqueia ultrapassagens e não aplica punições. São avisos orientativos, não uma bandeira oficial do simulador.

## Arquitetura

- `server.py`: serviço HTTP que mantém o estado GREEN/VSC/RED e recebe comandos autenticados.
- `director.py`: ferramenta inicial da direção de prova para ativar comandos.
- `ac-app/RookieRaceControl/`: aplicativo Python exibido no HUD do Assetto Corsa; consulta o serviço a cada 2 segundos.

## Teste local no Windows

1. Instale Python 3 no computador da direção de prova.
2. No PowerShell, na pasta `race-control`, defina um token forte: `$env:RL_RC_ADMIN_TOKEN="COLOQUE_UM_SEGREDO_LONGO_AQUI"`.
3. Execute `python server.py`. O serviço escuta somente `127.0.0.1:8765` por padrão.
4. Em outro PowerShell, configure o mesmo token e rode:
   - `python director.py VSC --speed 80`
   - `python director.py RED --message "Corrida interrompida; aguarde instrucoes"`
   - `python director.py GREEN`
5. Copie a pasta `ac-app/RookieRaceControl` para `assettocorsa/apps/python/RookieRaceControl`.
6. Ative o app em Content Manager → Settings → Assetto Corsa → Python Apps (ou menu equivalente), abra o simulador e habilite o widget na barra de apps.
7. Se o servidor rodar em outro computador, ajuste `state_url` em `config.ini` para o endpoint **HTTPS** publicado para os pilotos.

## Segurança e produção

- O token administrativo fica **apenas** no serviço e no terminal da direção de prova; nunca o coloque no app do piloto.
- O endpoint GET /api/state é somente leitura e público; não inclua dados privados em mensagens.
- Não exponha o serviço HTTP diretamente na internet. Para acesso remoto, use HTTPS com proxy reverso, proteção contra abuso e controle de rede.
- O serviço armazena o estado em arquivo JSON. Para múltiplas instâncias, será preciso um armazenamento compartilhado.
- A opção `--host 0.0.0.0` só deve ser usada atrás de rede/proxy protegido.
- Se o app perder conexão, mostra **SEM CONEXAO**; não assuma pista verde.
- Os comandos precisam de procedimentos oficiais de direção de prova e confirmação humana.

## Próximas etapas

1. Validar exibição no AC original com CSP e diferentes resoluções.
2. Integrar os botões da direção de prova ao portal com autenticação de comissário e registro de auditoria.
3. Integrar ao protocolo de plugin do servidor dedicado AC para avisos via chat e monitoramento de velocidades.
4. Implementar lógica VSC com detecção de excesso e relatório, sem alegar imposição automática antes dos testes.
5. Definir protocolo operacional para bandeira vermelha, retomada e formação do grid.
