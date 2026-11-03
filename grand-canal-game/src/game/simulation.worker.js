import { startGame, advanceGame, commandGame, previewGame } from './session.js';
self.onmessage = ({ data }) => {
  try {
    let result;
    switch (data.type) {
      case 'start': result = startGame(data.id, data.seed); break;
      case 'advance': result = advanceGame(data.limit); break;
      case 'command': result = commandGame(data.command); break;
      case 'preview': result = previewGame(data.command); break;
      default: throw Error('未知请求。');
    }
    self.postMessage({ requestId: data.requestId, result });
  } catch (error) {
    self.postMessage({ requestId: data.requestId, error: error.message });
  }
};
