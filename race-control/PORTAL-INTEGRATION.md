# Rookie Portal Flags — integração Assetto Corsa + Portal

**Objetivo:** mostrar no Assetto Corsa original as mesmas bandeiras GREEN/VSC/RED acionadas no Race Chat do Portal Rookie League.

## Como funciona

Portal (administrador) → função Supabase `set_race_chat_flag` → tabela `race_chat_flags` → Edge Function pública **somente leitura** `race-control-flags` → aplicativo Python do Assetto Corsa (consulta a cada 2 segundos).

A Edge Function expõe apenas `mode`, `version` e `updated_at`. Não permite alterar bandeiras nem expõe tokens administrativos. **Não depende de plugins da Emperor Servers.**

## Ativação obrigatória no Supabase

1. A migração `supabase/migrations/20261108_race_chat_flags.sql` deve estar aplicada (já utilizada pelo Race Chat).
2. No painel Supabase, abra **Edge Functions** e publique a função `race-control-flags` usando `supabase/functions/race-control-flags/index.ts`.
3. **Desative a verificação de JWT para esta função específica**, pois o aplicativo do piloto faz apenas uma consulta pública de estado. Alternativamente, use a CLI: `supabase functions deploy race-control-flags --no-verify-jwt`.
4. Abra `https://lxformxabgtgafykvhkw.supabase.co/functions/v1/race-control-flags` e confirme que retorna JSON com `mode` e `version`. Se houver 401, verifique a configuração de JWT; se houver 404, a função ainda não foi publicada.

**Atenção:** essa URL é pública e revela apenas o estado das bandeiras. Não publique nela dados de pilotos, tokens, identificadores privados ou mensagens sensíveis.

## Instalação no PC de cada piloto

1. Copie a pasta `race-control/ac-app/RookiePortalFlags` para `assettocorsa/apps/python/RookiePortalFlags`.
2. Ative **RookiePortalFlags** nas configurações de Python Apps do Content Manager/Assetto Corsa.
3. Abra o Assetto Corsa e habilite o app **Rookie Flags** na barra lateral de apps.
4. Com o portal aberto em outra janela, o administrador pode acionar RED, VSC e GREEN; o app deverá atualizar em aproximadamente 2 segundos.

## Limitações

- Primeira versão: **visualização somente**, sem imposição de limite de velocidade, penalidades, pausas ou mudanças nativas no servidor.
- O HUD depende de internet e do acesso HTTPS do Python embarcado no Assetto Corsa. Se perder a conexão, mostrará **SEM CONEXAO**.
- A interface não toca áudio dentro do jogo; o áudio continua no Race Chat do navegador.
- Testar em instalação real de Assetto Corsa com Content Manager/CSP; ainda não validado em jogo.
- A função mostra o estado da **Sala Geral** (`rookie-general`). Futuramente poderemos separar bandeiras por campeonato/sala.
