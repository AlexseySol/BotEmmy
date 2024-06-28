require('dotenv').config();
const { Telegraf, session } = require('telegraf');
const axios = require('axios');
const FormData = require('form-data');
const BOT_INSTRUCTIONS = require('./instructions');

const BOT_TOKEN = process.env.BOT_TOKEN;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_CHAT_API_URL = 'https://api.openai.com/v1/chat/completions';
const OPENAI_WHISPER_API_URL = 'https://api.openai.com/v1/audio/transcriptions';

if (!BOT_TOKEN || !OPENAI_API_KEY) {
  console.error('Необходимо указать BOT_TOKEN и OPENAI_API_KEY в файле .env');
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);

/* const instructions = `Просто коротко поздаровайся`; */

bot.use(session({
  property: 'session',
  getSessionKey: (ctx) => ctx.from && ctx.chat && `${ctx.from.id}:${ctx.chat.id}`,
}));

async function generateResponse(prompt, sessionMessages) {
  const messages = [
    { role: 'system', content: BOT_INSTRUCTIONS },
    ...sessionMessages,
    { role: 'user', content: prompt }
  ];

  try {
    const response = await axios.post(OPENAI_CHAT_API_URL, {
      model: 'gpt-4o',
      messages: messages,
      max_tokens: 1000,
      temperature: 0.1
    }, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`
      }
    });

    const data = response.data;
    console.log('Ответ от OpenAI API:', data);

    if (data.choices && data.choices.length > 0) {
      return data.choices[0].message.content.trim();
    } else if (data.error) {
      throw new Error(`Ошибка API: ${data.error.message}`);
    } else {
      throw new Error('Пустой ответ от OpenAI API');
    }
  } catch (error) {
    console.error('Ошибка при взаимодействии с OpenAI API:', error);
    throw new Error('Ошибка при обработке запроса к OpenAI API.');
  }
}

async function transcribeAudio(fileLink) {
  try {
    console.log('Получение аудиофайла по ссылке:', fileLink);
    const response = await axios.get(fileLink, { responseType: 'arraybuffer' });
    const buffer = Buffer.from(response.data);

    const formData = new FormData();
    formData.append('file', buffer, { filename: 'audio.ogg', contentType: 'audio/ogg' });
    formData.append('model', 'whisper-1');

    console.log('Отправка аудиофайла в OpenAI Whisper API');
    const transcribeResponse = await axios.post(OPENAI_WHISPER_API_URL, formData, {
      headers: {
        ...formData.getHeaders(),
        'Authorization': `Bearer ${OPENAI_API_KEY}`
      }
    });

    const data = transcribeResponse.data;
    console.log('Ответ от OpenAI Whisper API:', data);

    if (data.error) {
      throw new Error(data.error.message);
    }

    return data.text;
  } catch (error) {
    console.error('Ошибка при распознавании аудио:', error);
    throw new Error('Ошибка при распознавании аудио.');
  }
}

async function analyzeImage(fileLink) {
  try {
    console.log('Получение изображения по ссылке:', fileLink);
    const response = await axios.get(fileLink, { responseType: 'arraybuffer' });
    const buffer = Buffer.from(response.data);

    console.log('Отправка изображения в OpenAI Vision API');
    const imageResponse = await axios.post(OPENAI_CHAT_API_URL, {
      model: "gpt-4o",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "Что изображено на этой картинке?" },
            { type: "image_url", image_url: { url: `data:image/jpeg;base64,${buffer.toString('base64')}` } }
          ]
        }
      ],
      max_tokens: 300
    }, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`
      }
    });

    const data = imageResponse.data;
    console.log('Ответ от OpenAI Vision API:', data);

    if (data.choices && data.choices.length > 0) {
      return data.choices[0].message.content.trim();
    } else if (data.error) {
      throw new Error(data.error.message);
    } else {
      throw new Error('Пустой ответ от OpenAI Vision API');
    }
  } catch (error) {
    console.error('Ошибка при анализе изображения:', error);
    throw new Error('Ошибка при анализе изображения.');
  }
}

bot.start((ctx) => {
  console.log(`Пользователь ${ctx.from.id} запустил бота`);
  ctx.reply('Добро пожаловать! Начните общение или введите команду.');
});

bot.on('voice', async (ctx) => {
  const fileId = ctx.message.voice.file_id;
  const fileLink = await ctx.telegram.getFileLink(fileId);

  try {
    console.log(`Пользователь ${ctx.from.id} отправил голосовое сообщение`);
    const text = await transcribeAudio(fileLink);
    console.log(`Распознанный текст: ${text}`);
    
    ctx.session.messages = ctx.session.messages || [];
    ctx.session.messages.push({ role: 'user', content: text });

    const assistantResponse = await generateResponse(text, ctx.session.messages);
    ctx.session.messages.push({ role: 'assistant', content: assistantResponse });

    await ctx.reply(assistantResponse);
  } catch (error) {
    console.error('Ошибка при распознавании аудио:', error);
    await ctx.reply('Произошла ошибка при распознавании аудио.');
  }
});

bot.on('photo', async (ctx) => {
  const fileId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
  const fileLink = await ctx.telegram.getFileLink(fileId);

  try {
    console.log(`Пользователь ${ctx.from.id} отправил изображение`);
    const description = await analyzeImage(fileLink);
    console.log(`Описание изображения: ${description}`);
    
    ctx.session.messages = ctx.session.messages || [];
    ctx.session.messages.push({ role: 'user', content: `Пользователь отправил изображение. Описание: ${description}` });


    
    const assistantResponse = await generateResponse(`Опиши это изображение: ${description}`, ctx.session.messages);
    ctx.session.messages.push({ role: 'assistant', content: assistantResponse });

    await ctx.reply(assistantResponse);
  } catch (error) {
    console.error('Ошибка при анализе изображения:', error);
    await ctx.reply('Произошла ошибка при анализе изображения.');
  }
});

bot.on('text', async (ctx) => {
  const userMessage = ctx.message.text;
  
  console.log(`Пользователь ${ctx.from.id} отправил текстовое сообщение: ${userMessage}`);
  ctx.session.messages = ctx.session.messages || [];
  ctx.session.messages.push({ role: 'user', content: userMessage });

  try {
    const assistantResponse = await generateResponse(userMessage, ctx.session.messages);
    ctx.session.messages.push({ role: 'assistant', content: assistantResponse });
    console.log(`Ответ ассистента: ${assistantResponse}`);
    await ctx.reply(assistantResponse);
  } catch (error) {
    console.error('Ошибка при обработке запроса к OpenAI:', error);
    await ctx.reply('Произошла ошибка при обработке вашего запроса.');
  }
});

bot.launch().then(() => {
  console.log('Бот запущен');
}).catch((error) => {
  console.error('Ошибка запуска бота:', error);
});