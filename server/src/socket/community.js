// server/src/socket/community.js
exports.initCommunitySocket = (io) => {
  const community = io.of('/community');

  community.on('connection', (socket) => {
    socket.on('join:room', (roomName) => {
      socket.join(roomName);
      console.log(`🏘️ User joined community room: ${roomName}`);
    });

    socket.on('message:send', ({ roomName, user, text }) => {
      community.to(roomName).emit('message:receive', {
        user,
        text,
        timestamp: new Date(),
      });
    });
  });
};
