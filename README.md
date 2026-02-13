# TEZ Watchparty

Aplicação web estilo Rave para assistir vídeos em grupo com sincronização de player, chat em tempo real e login.

## Funcionalidades

- Cadastro e login de usuários
- Criação/entrada em salas por código
- Player de vídeo HTML5 sincronizado (play/pause/seek)
- Chat em tempo real por sala

## Como rodar

```bash
npm install
npm start
```

Abra `http://localhost:3000` no navegador.

## Observações

- Para produção, altere `JWT_SECRET`.
- O campo de vídeo espera URL direta de arquivo de vídeo (ex.: `.mp4`).
