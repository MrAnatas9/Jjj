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

const PORT = process.env.PORT || 10000;

// Игровые комнаты
const rooms = new Map();

app.use(express.static(path.join(__dirname, 'public')));

// Главная страница с созданием комнаты
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Страница для присоединения к комнате
app.get('/room/:roomId', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Генерация случайного ID комнаты
function generateRoomId() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

io.on('connection', (socket) => {
  console.log('Новый игрок подключился:', socket.id);

  // Создание новой комнаты
  socket.on('createRoom', () => {
    const roomId = generateRoomId();
    const room = {
      id: roomId,
      players: {},
      gameState: {
        ball: { 
          x: 400, y: 300, 
          dx: 5, dy: 5,
          speed: 5
        },
        players: {},
        scores: { player1: 0, player2: 0 },
        paddleHeight: 100,
        paddleWidth: 10,
        canvasWidth: 800,
        canvasHeight: 600,
        isPlaying: false
      },
      playerCount: 0
    };
    
    rooms.set(roomId, room);
    socket.join(roomId);
    socket.emit('roomCreated', roomId);
    console.log(`Комната создана: ${roomId}`);
  });

  // Присоединение к комнате
  socket.on('joinRoom', (roomId) => {
    const room = rooms.get(roomId);
    
    if (!room) {
      socket.emit('roomNotFound');
      return;
    }

    if (room.playerCount >= 2) {
      socket.emit('roomFull');
      return;
    }

    socket.join(roomId);
    room.playerCount++;
    const playerId = room.playerCount === 1 ? 'player1' : 'player2';
    
    room.players[playerId] = {
      id: socket.id,
      y: room.gameState.canvasHeight / 2 - room.gameState.paddleHeight / 2,
      score: 0
    };

    room.gameState.players[playerId] = room.players[playerId];

    socket.emit('playerAssigned', { 
      playerId, 
      gameState: room.gameState,
      roomId: roomId
    });

    // Уведомляем всех в комнате о новом игроке
    io.to(roomId).emit('playerJoined', {
      playerId,
      playerCount: room.playerCount
    });

    // Если комната заполнена, начинаем игру
    if (room.playerCount === 2) {
      room.gameState.isPlaying = true;
      io.to(roomId).emit('gameStart', room.gameState);
      startGameLoop(roomId);
    }

    // Отправляем обновлённое состояние всем игрокам
    io.to(roomId).emit('gameStateUpdate', room.gameState);
  });

  // Обработка движения платформы
  socket.on('paddleMove', (data) => {
    // Находим комнату игрока
    for (let [roomId, room] of rooms) {
      for (let playerKey in room.players) {
        if (room.players[playerKey].id === socket.id) {
          if (room.players[playerKey]) {
            room.players[playerKey].y = data.y;
            room.gameState.players[playerKey].y = data.y;
            io.to(roomId).emit('gameStateUpdate', room.gameState);
          }
          return;
        }
      }
    }
  });

  socket.on('disconnect', () => {
    console.log('Игрок отключился:', socket.id);
    
    // Удаляем игрока из комнаты
    for (let [roomId, room] of rooms) {
      for (let playerKey in room.players) {
        if (room.players[playerKey].id === socket.id) {
          room.playerCount--;
          delete room.players[playerKey];
          delete room.gameState.players[playerKey];
          
          io.to(roomId).emit('playerDisconnected', playerKey);
          
          // Если комната пустая, удаляем её
          if (room.playerCount === 0) {
            rooms.delete(roomId);
            console.log(`Комната удалена: ${roomId}`);
          }
          break;
        }
      }
    }
  });
});

// Игровой цикл для комнаты
function startGameLoop(roomId) {
  const room = rooms.get(roomId);
  if (!room) return;

  const gameLoop = setInterval(() => {
    if (!room.gameState.isPlaying || room.playerCount < 2) {
      clearInterval(gameLoop);
      return;
    }

    const ball = room.gameState.ball;
    const canvasWidth = room.gameState.canvasWidth;
    const canvasHeight = room.gameState.canvasHeight;
    const paddleWidth = room.gameState.paddleWidth;
    const paddleHeight = room.gameState.paddleHeight;

    // Двигаем мяч
    ball.x += ball.dx;
    ball.y += ball.dy;

    // Отскок от верхней и нижней стенки
    if (ball.y <= 0 || ball.y >= canvasHeight) {
      ball.dy = -ball.dy;
    }

    // Проверка столкновения с платформами
    const ballSize = 10;
    
    // Левая платформа (player1)
    if (room.players.player1) {
      const player1 = room.players.player1;
      if (ball.x <= 20 + paddleWidth && 
          ball.x >= 20 &&
          ball.y >= player1.y && 
          ball.y <= player1.y + paddleHeight) {
        ball.dx = Math.abs(ball.dx);
        ball.x = 20 + paddleWidth + 1;
        // Увеличиваем скорость после отскока
        ball.dx *= 1.1;
        ball.dy *= 1.1;
      }
    }

    // Правая платформа (player2)
    if (room.players.player2) {
      const player2 = room.players.player2;
      if (ball.x >= canvasWidth - 20 - paddleWidth && 
          ball.x <= canvasWidth - 20 &&
          ball.y >= player2.y && 
          ball.y <= player2.y + paddleHeight) {
        ball.dx = -Math.abs(ball.dx);
        ball.x = canvasWidth - 20 - paddleWidth - 1;
        // Увеличиваем скорость после отскока
        ball.dx *= 1.1;
        ball.dy *= 1.1;
      }
    }

    // Забитие гола
    if (ball.x < 0) {
      if (room.players.player2) room.players.player2.score++;
      resetBall(room);
    } else if (ball.x > canvasWidth) {
      if (room.players.player1) room.players.player1.score++;
      resetBall(room);
    }

    // Обновляем счёт в gameState
    if (room.players.player1) room.gameState.players.player1.score = room.players.player1.score;
    if (room.players.player2) room.gameState.players.player2.score = room.players.player2.score;

    io.to(roomId).emit('gameStateUpdate', room.gameState);

  }, 1000 / 60);
}

function resetBall(room) {
  const ball = room.gameState.ball;
  ball.x = room.gameState.canvasWidth / 2;
  ball.y = room.gameState.canvasHeight / 2;
  ball.dx = (Math.random() > 0.5 ? 1 : -1) * 5;
  ball.dy = (Math.random() - 0.5) * 8;
  ball.speed = 5;
}

server.listen(PORT, () => {
  console.log(`Сервер запущен на порту ${PORT}`);
});
