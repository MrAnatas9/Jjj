const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 3000;

// Игровое состояние
const gameState = {
  ball: { x: 400, y: 300, dx: 5, dy: 5 },
  players: {},
  scores: { player1: 0, player2: 0 },
  paddleHeight: 100,
  paddleWidth: 10,
  canvasWidth: 800,
  canvasHeight: 600
};

let playerCount = 0;

app.use(express.static(path.join(__dirname, 'public')));

io.on('connection', (socket) => {
  console.log('Новый игрок подключился:', socket.id);

  if (playerCount < 2) {
    playerCount++;
    const playerId = playerCount === 1 ? 'player1' : 'player2';
    
    gameState.players[playerId] = {
      id: socket.id,
      y: gameState.canvasHeight / 2 - gameState.paddleHeight / 2,
      score: 0
    };

    socket.emit('playerAssigned', { playerId, gameState });
    
    // Уведомляем всех об обновлении состояния
    io.emit('gameStateUpdate', gameState);

    // Обработка движения платформы
    socket.on('paddleMove', (data) => {
      if (gameState.players[playerId]) {
        gameState.players[playerId].y = data.y;
        io.emit('gameStateUpdate', gameState);
      }
    });

    socket.on('disconnect', () => {
      console.log('Игрок отключился:', socket.id);
      delete gameState.players[playerId];
      playerCount--;
      io.emit('playerDisconnected', playerId);
    });
  } else {
    socket.emit('gameFull');
    socket.disconnect();
  }
});

// Игровой цикл
function gameLoop() {
  // Двигаем мяч
  gameState.ball.x += gameState.ball.dx;
  gameState.ball.y += gameState.ball.dy;

  // Отскок от верхней и нижней стенки
  if (gameState.ball.y <= 0 || gameState.ball.y >= gameState.canvasHeight) {
    gameState.ball.dy = -gameState.ball.dy;
  }

  // Проверка столкновения с платформами
  const ballSize = 10;
  
  // Левая платформа (player1)
  if (gameState.players.player1) {
    if (gameState.ball.x <= 20 + gameState.paddleWidth && 
        gameState.ball.x >= 20 &&
        gameState.ball.y >= gameState.players.player1.y && 
        gameState.ball.y <= gameState.players.player1.y + gameState.paddleHeight) {
      gameState.ball.dx = Math.abs(gameState.ball.dx);
      gameState.ball.x = 20 + gameState.paddleWidth + 1;
    }
  }

  // Правая платформа (player2)
  if (gameState.players.player2) {
    if (gameState.ball.x >= gameState.canvasWidth - 20 - gameState.paddleWidth && 
        gameState.ball.x <= gameState.canvasWidth - 20 &&
        gameState.ball.y >= gameState.players.player2.y && 
        gameState.ball.y <= gameState.players.player2.y + gameState.paddleHeight) {
      gameState.ball.dx = -Math.abs(gameState.ball.dx);
      gameState.ball.x = gameState.canvasWidth - 20 - gameState.paddleWidth - 1;
    }
  }

  // Забитие гола
  if (gameState.ball.x < 0) {
    if (gameState.players.player2) gameState.players.player2.score++;
    resetBall();
  } else if (gameState.ball.x > gameState.canvasWidth) {
    if (gameState.players.player1) gameState.players.player1.score++;
    resetBall();
  }

  io.emit('gameStateUpdate', gameState);
}

function resetBall() {
  gameState.ball.x = gameState.canvasWidth / 2;
  gameState.ball.y = gameState.canvasHeight / 2;
  gameState.ball.dx = Math.random() > 0.5 ? 5 : -5;
  gameState.ball.dy = (Math.random() - 0.5) * 10;
}

setInterval(gameLoop, 1000 / 60);

server.listen(PORT, () => {
  console.log(`Сервер запущен на порту ${PORT}`);
});