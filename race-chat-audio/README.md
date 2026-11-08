# Voz natural para as bandeiras — Race Chat

O Race Chat procura primeiro **arquivos MP3 gravados**. Isso garante que os pilotos ouçam a mesma voz, sem depender das vozes instaladas no Windows ou navegador.

Coloque estes três arquivos nesta pasta do repositório:

- `red.mp3` — “Atenção, pilotos! Bandeira vermelha. Corrida interrompida. Aguardem instruções da direção de prova.”
- `vsc.mp3` — “Atenção, pilotos! Virtual Safety Car ativado. Reduzam a velocidade. Ultrapassagens proibidas.”
- `green.mp3` — “Bandeira verde! Pista liberada. Corrida retomada. Boa prova a todos!”

**Importante:** os arquivos de áudio **ainda não estão incluídos**. Até serem adicionados, o sistema utiliza a síntese de voz pt-BR disponível no navegador. A nova seleção prioriza vozes com nomes “Natural” ou “Neural” quando disponíveis, mas a qualidade depende do dispositivo.

Sugestão de gravação: locução brasileira natural, tom firme de direção de prova, volume normalizado e silêncio curto entre frases. Evite música ou efeitos que prejudiquem a inteligibilidade.

Os áudios só são disparados quando há mudança de bandeira para um piloto conectado à Sala Geral, com áudio liberado pelo navegador. Teste em Chrome/Edge e com o simulador em primeiro plano antes de usar em corrida oficial.
