# Corrigir “unknown url type: https” no Assetto Corsa

O Python embarcado no Assetto Corsa pode não ter suporte a SSL/HTTPS. **Não desative a verificação de certificados.**

A ponte local `flags-bridge.py` usa o Python 3 instalado no Windows para consultar o Supabase por HTTPS, com validação TLS padrão. O plugin consulta apenas `http://127.0.0.1:8766/api/state` no mesmo computador.

## Instalação

1. Instale Python 3 no Windows se ainda não tiver.
2. Baixe `race-control/flags-bridge.py` e execute no PowerShell: `python flags-bridge.py`.
3. Deixe a janela do PowerShell aberta durante a corrida. Teste no navegador do mesmo PC: `http://127.0.0.1:8766/api/state`.
4. Atualize o arquivo `config.ini` do plugin em `assettocorsa/apps/python/RookiePortalFlags/config.ini` com:
   ```ini
   [CONTROL]
   state_url = http://127.0.0.1:8766/api/state
   poll_seconds = 2
   ```
5. Reinicie o Assetto Corsa. O HUD deve exibir a bandeira atual do portal.

**Segurança:** o serviço escuta exclusivamente em `127.0.0.1` e não aceita comandos de escrita. Se a comunicação com o Supabase cair ou ficar desatualizada, o estado será `OFFLINE`. Não é necessário configurar portas na Emperor Servers.

Esta solução requer a ponte em execução no PC de cada piloto. Futuramente pode ser empacotada com um inicializador automático.
