# Devoid Web 4.1

Navegador da marca **Devoid**, uma empresa **DEBUG**. Feito sobre Electron (Chromium).

## Rodar e gerar o instalador

No Windows, instale o Node.js (versão LTS, em nodejs.org) e depois:

- dois cliques em `iniciar.bat` abre o navegador (na primeira vez ele instala as peças sozinho);
- dois cliques em `gerar-instalador.bat` cria o `.exe` na pasta `dist`.

Pelo terminal: `npm install`, depois `npm start`, ou `npm run build:win`, `build:mac` ou `build:linux`. Cada instalador deve ser gerado no sistema correspondente. Se o electron-builder acusar erro em `build/installer.nsh`, apague a linha `"include"` em `package.json` > `build` > `nsis`.

## Ajustes da versão 4.1

- **Papel de parede removido por completo:** sem opções em Configurações, sem o protocolo `devoid-wall://`, sem o container na nova aba e sem os canais de IPC. A pasta `userData/wallpaper` que a versão anterior criou é apagada na próxima abertura.
- **Menu ☰ > Extensões:** agora abre a página de gerenciamento (`devoid://extensions`, arquivo `ui/extensions.html`) em uma aba, com a lista de extensões, fixar, remover e instalar por link da Chrome Web Store, arquivo `.crx` ou pasta. `chrome://extensions` na barra de endereços leva ao mesmo lugar, e o ícone de quebra-cabeça da barra continua abrindo o painel rápido, agora com o atalho "Gerenciar extensões".
- **Painéis que fechavam sozinhos:** o menu ☰ perdia o foco para o painel seguinte (por exemplo o do tradutor) e avisava tarde demais, o que fechava o painel novo. Esse aviso atrasado agora é filtrado.

## Novidades da versão 4

- **Seletor de perfis na inicialização** (`ui/profiles.html`): abre antes de qualquer janela do navegador, a menos que você marque "Lembrar escolha e iniciar direto neste perfil". Cada perfil tem pasta própria em `userData/profiles/<id>/` (favoritos, histórico e sessão) e sessão isolada em `persist:profile_<id>` (cookies, logins, cache). O **Convidado** usa a partição `guest`, em memória: nada vai para o disco e tudo é apagado quando a última janela de convidado fecha. Dá para criar (nome, cor e ícone) e excluir perfis na própria tela, e gerenciar depois em `devoid://accounts`.
- **Bloqueador de anúncios, pop-up corrigido** (`ui/adblock-popup.html`): página própria, aberta pelo caminho absoluto, com texto de reserva (nunca fica em branco). Recebe os dados por `get-adblock-stats` e atualiza a cada segundo. Tem chave por site, chave geral (também em Configurações) e lista do que passou quando o bloqueio está desligado.
- **Convivência com extensões:** se houver uBlock, AdGuard, AdBlock, Ghostery ou similar no perfil, o bloqueio nativo sai de cena sozinho naquele perfil e o pop-up avisa.
- **Player de áudio no menu ☰:** Play, Pause, Avançar, Voltar, linha do tempo, volume, tempo decorrido e total, repetir, aleatório e lista de faixas. Abre arquivos (mp3, flac, wav, ogg, aac, m4a) ou uma pasta inteira. A tag `<audio>` fica oculta na janela principal, então a música continua com o menu fechado. Atalhos: Ctrl+Alt+Espaço, Ctrl+Alt+→, Ctrl+Alt+← e as teclas de mídia do teclado (só enquanto há uma lista aberta).
- **Modo leitura:** o ícone de livro aparece na barra de endereços em páginas com artigo (também Ctrl+Alt+R). Extrai título, autor, capa e texto, sem menus, barras laterais, anúncios nem scripts da página, e mostra numa aba limpa com A−/A+, três temas (Escuro Cyberpunk, Sépia, Branco Leitura) e tempo estimado de leitura.
- **Segurança:** `X-Content-Type-Options: nosniff` e `Referrer-Policy: strict-origin-when-cross-origin` entram nas páginas que não os enviam (nunca sobrescrevem o que o site mandou). `contextIsolation`, `sandbox`, `webSecurity` e `nodeIntegration: false` valem para todas as janelas e abas, e o preload expõe só uma lista fechada de canais.
- **Correções de base:** o user agent sem "Electron" agora vale em todas as sessões de perfil; favoritos, histórico e sugestões da barra são por perfil.

## Sobre o BrowserAudit e os cabeçalhos

- O BrowserAudit testa se o **navegador respeita** cabeçalhos que os servidores de teste enviam. Acrescentar cabeçalhos do lado do cliente não muda esse resultado. Não dá para prometer "399+ passed, 0 critical".
- `X-Frame-Options: SAMEORIGIN` **não** é forçado por padrão: aplicado em toda resposta, ele impediria iframes de outros sites (YouTube, pagamentos, logins). Existe uma chave opcional em Configurações > Privacidade ("Exigir que iframes de outros sites se declarem embutíveis") para quem quiser.
- `X-XSS-Protection` não foi adicionado: o Chromium ignora esse cabeçalho e a OWASP recomenda não usá-lo.
- Outros itens do BrowserAudit dependem do próprio Chromium (certificados, CORS, cookies, mixed content). O Devoid Web não os enfraquece.

## Atalhos

| Ação | Atalho |
| --- | --- |
| Nova aba / janela / janela anônima (convidado) | Ctrl+T / Ctrl+N / Ctrl+Shift+N |
| Fechar aba / reabrir aba fechada | Ctrl+W / Ctrl+Shift+T |
| Próxima / anterior | Ctrl+Tab / Ctrl+Shift+Tab |
| Barra de endereço | Ctrl+L |
| Recarregar | Ctrl+R ou F5 |
| Voltar / avançar | Alt+← / Alt+→ |
| Favoritar | Ctrl+D |
| Favoritos / histórico / downloads | Ctrl+Shift+O / Ctrl+H / Ctrl+J |
| Modo leitura | Ctrl+Alt+R |
| Picture-in-Picture | Ctrl+Shift+P |
| Áudio: tocar ou pausar / próxima / anterior | Ctrl+Alt+Espaço / Ctrl+Alt+→ / Ctrl+Alt+← |
| Zoom | Ctrl+ + / Ctrl+ - / Ctrl+0 |
| Tela cheia / DevTools | F11 / F12 ou Ctrl+Shift+I |

No macOS, Cmd no lugar de Ctrl.

## Como testar

1. **Perfis:** abra o navegador, crie um perfil e entre nele; faça login em um site e abra o perfil Principal para ver que o login não aparece. Abra o Convidado, navegue, feche a janela e abra de novo: nada fica.
2. **Lembrar escolha:** marque a caixa e reabra; ele vai direto ao perfil. Para voltar a escolher, abra `devoid://accounts` e desmarque "Iniciar direto no perfil desta janela, sem perguntar".
3. **Bloqueador:** abra um portal de notícias e clique no escudo. O número sobe em tempo real. Desligue "Bloquear neste site" e veja a lista do que passou.
4. **Extensão bloqueadora:** instale o uBlock Origin (menu ☰ > Extensões); o pop-up passa a mostrar "Extensão bloqueadora detectada" e o bloqueio nativo pausa.
5. **Áudio:** menu ☰ > Arquivos… ou Pasta…; feche o menu e a música continua. Teste as teclas de mídia.
6. **Modo leitura:** abra uma matéria de jornal ou blog e clique no ícone de livro.
7. **GPU e memória:** `devoid://gpu` e Configurações > Desempenho > Diagnóstico mostram aceleração, CPU e memória por processo.
8. **Cabeçalhos:** DevTools (F12) > Network em uma página de teste mostra os cabeçalhos recebidos; o `X-Content-Type-Options` aparece mesmo se o site não o enviar.

## Limites que você precisa saber

- **Não consegui executar o app aqui** (sem rede para baixar o Electron). Foram feitas checagens de sintaxe, 527 verificações da lógica com o Electron simulado (perfis, dados por perfil, bloqueio, cabeçalhos, detecção de extensões, áudio, rota do menu Extensões, filtro de foco dos painéis e o extrator do modo leitura num DOM de teste) e o carregamento dos módulos principais. As telas, o seletor de perfis, o pop-up, o áudio e o instalador precisam do seu teste.
- **Cookies da versão anterior:** o perfil Principal agora usa a partição `persist:profile_main`. Favoritos e histórico antigos são migrados para ele, mas os logins que estavam na sessão padrão não, e será preciso entrar de novo.
- **Modo leitura:** o extrator é nativo (sem a biblioteca Readability, que exigiria baixar um pacote). Ele pontua os parágrafos da página; em sites muito fora do padrão pode pegar o trecho errado ou recusar. Foi testado só num DOM de teste.
- **Pasta de músicas:** no Windows e no Linux, uma caixa de seleção não escolhe arquivos e pastas ao mesmo tempo, então há dois botões ("Arquivos…" e "Pasta…").
- **Lista de bloqueio:** a embutida é inicial (cerca de 250 domínios); importe uma lista de hosts em Configurações para cobertura ampla.
- **Contas:** o Google e outros serviços podem recusar login em navegadores novos.
- **Extensões:** o Electron implementa só parte da API do Chrome; popups que dependem de `chrome.tabs` podem funcionar só em parte.
- **RAM:** abas inativas são suspensas e há limpeza passiva de caches, mas um app Electron sempre tem um consumo-base.

## Onde mexer

| Arquivo | O que muda |
| --- | --- |
| `src/main.js` | Flags, DNS, menu, escolha de perfil na inicialização, limpeza ao sair |
| `src/modules/chooser.js`, `profiles.js` | Janela de seleção e perfis (pastas, partições, convidado) |
| `src/modules/browser.js` | Janela, abas, grupos, divisão, PiP, pop-up do bloqueador, leitura, áudio |
| `src/modules/security.js` | Protocolos, permissões, bloqueio, cabeçalhos, certificados, user agent |
| `src/modules/extensions.js`, `audio.js`, `reader.js` | Extensões e detecção de bloqueadores, áudio, extração de artigo |
| `src/modules/ipc.js`, `src/preload.js` | Canais validados e lista fechada exposta às telas |
| `src/ui/profiles.*`, `adblock-popup.*`, `extensions.*`, `welcome.*`, `settings.*` | Seleção de perfil, pop-up, gerenciador de extensões, boas-vindas, configurações |
| `src/ui/i18n.js` | Dicionário português, inglês e espanhol |
| `src/pages/` | Nova aba, leitura, favoritos, histórico, downloads, contas e tutorial de extensões |
