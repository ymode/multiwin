# YouTube Multiscreen Player - Multi-User Deployment Version

A full-stack web application that allows users to watch multiple YouTube videos simultaneously in a grid layout, with user authentication and the ability to save and load custom video layouts.

![Screenshot 2024-11-06 180450](https://github.com/user-attachments/assets/513b0103-22e5-42b8-a7e2-2852c157181c)

## Features

### Video Player Features
- Add multiple YouTube videos to a single page
- Responsive grid layout that adapts to screen size
- Support for various YouTube URL formats
- Individual video removal controls
- Resizable video panels (1x, 2x, 3x width)
- Drag and drop to reorder videos
- Fullscreen mode for individual videos
- Clean, modern user interface
- Keyboard support (Enter to add videos)

### User Features (New!)
- **User Authentication**: Secure signup and login system
- **Save Layouts**: Save your favorite video configurations
- **Load Layouts**: Quick access to previously saved layouts
- **User Sessions**: Your layouts are private and persistent
- **Multi-user Support**: Each user has their own saved layouts

## Tech Stack

- **Frontend**: HTML5, CSS3, Vanilla JavaScript
- **Backend**: Node.js, Express.js
- **Database**: SQLite (easily replaceable with PostgreSQL/MySQL)
- **Authentication**: bcryptjs for password hashing
- **Session Management**: express-session

## Installation

### Prerequisites
- Node.js (v14 or higher)
- npm or yarn

### Local Development Setup

1. **Clone the repository**
   ```bash
   git clone <your-repo-url>
   cd multiwin
   git checkout deploy
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Configure environment variables**
   ```bash
   cp .env.example .env
   ```

   Edit `.env` and set your own `SESSION_SECRET`:
   ```
   PORT=3000
   NODE_ENV=development
   SESSION_SECRET=your-super-secret-random-string-here
   ```

4. **Start the server**
   ```bash
   # Development mode with auto-reload
   npm run dev

   # Production mode
   npm start
   ```

5. **Access the application**

   Open your browser and navigate to: `http://localhost:3000`

## Deployment

### Deploy to Heroku

1. **Create a Heroku app**
   ```bash
   heroku create your-app-name
   ```

2. **Set environment variables**
   ```bash
   heroku config:set NODE_ENV=production
   heroku config:set SESSION_SECRET=$(openssl rand -base64 32)
   ```

3. **Deploy**
   ```bash
   git push heroku deploy:main
   ```

4. **Open your app**
   ```bash
   heroku open
   ```

### Deploy to Railway

1. Create a new project on [Railway](https://railway.app)
2. Connect your GitHub repository
3. Select the `deploy` branch
4. Add environment variables in Railway dashboard:
   - `NODE_ENV=production`
   - `SESSION_SECRET=<generate-random-string>`
5. Railway will automatically deploy your app

### Deploy to Render

1. Create a new Web Service on [Render](https://render.com)
2. Connect your GitHub repository
3. Configure:
   - **Branch**: `deploy`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
4. Add environment variables:
   - `NODE_ENV=production`
   - `SESSION_SECRET=<generate-random-string>`
5. Deploy!

### Deploy to DigitalOcean App Platform

1. Create a new app on [DigitalOcean](https://www.digitalocean.com/products/app-platform)
2. Connect your repository and select the `deploy` branch
3. Configure environment variables
4. Deploy with one click

### Deploy with Docker

1. **Create a Dockerfile**
   ```dockerfile
   FROM node:18-alpine
   WORKDIR /app
   COPY package*.json ./
   RUN npm ci --only=production
   COPY . .
   EXPOSE 3000
   CMD ["node", "server.js"]
   ```

2. **Build and run**
   ```bash
   docker build -t multiwin .
   docker run -p 3000:3000 -e SESSION_SECRET=your-secret multiwin
   ```

## Database

The application uses SQLite by default for easy setup. For production, you can switch to PostgreSQL or MySQL:

### Using PostgreSQL

1. Install the PostgreSQL driver:
   ```bash
   npm install pg pg-hstore
   ```

2. Update `server.js` to use PostgreSQL instead of SQLite

3. Set the `DATABASE_URL` environment variable

## Project Structure

```
multiwin/
├── public/                 # Frontend files
│   ├── app.html           # Main application (authenticated users)
│   ├── login.html         # Login page
│   └── register.html      # Registration page
├── server.js              # Express server and API routes
├── package.json           # Dependencies and scripts
├── .env.example           # Environment variables template
├── .gitignore            # Git ignore rules
├── Procfile              # Heroku deployment config
└── README.md             # This file
```

## API Endpoints

### Authentication
- `POST /api/register` - Create new user account
- `POST /api/login` - Authenticate user
- `POST /api/logout` - End user session
- `GET /api/user` - Get current user info

### Layouts
- `GET /api/layouts` - Get user's saved layouts
- `POST /api/layouts` - Save a new layout
- `PUT /api/layouts/:id` - Update a layout
- `DELETE /api/layouts/:id` - Delete a layout

## Usage

1. **Sign Up**: Create a new account
2. **Add Videos**: Paste YouTube URLs to add videos to your grid
3. **Customize**: Resize, reorder, and arrange videos as you like
4. **Save**: Click "Save Layout" to preserve your configuration
5. **Load**: Access your saved layouts anytime with "Load Layout"

## Supported URL Formats

The player supports various YouTube URL formats:
- Standard watch URLs: `https://www.youtube.com/watch?v=VIDEO_ID`
- Short URLs: `https://youtu.be/VIDEO_ID`
- Embed URLs: `https://www.youtube.com/embed/VIDEO_ID`
- Shorts URLs: `https://www.youtube.com/shorts/VIDEO_ID`

## Security Notes

⚠️ **Important for Production Deployment:**

1. **Change the SESSION_SECRET**: Generate a strong random string
   ```bash
   openssl rand -base64 32
   ```

2. **Use HTTPS**: Enable secure cookies in production

3. **Database**: Consider using PostgreSQL or MySQL for production instead of SQLite

4. **Rate Limiting**: Add rate limiting middleware to prevent abuse

5. **Input Validation**: The app includes basic validation, but consider adding more robust validation for production

## Browser Support

Works in all modern browsers that support:
- CSS Grid
- ES6 JavaScript
- YouTube iFrame API

## Contributing

Feel free to submit issues and pull requests!

## License

MIT License - Feel free to use and modify this code for your own projects.

## Troubleshooting

### Port already in use
Change the `PORT` in your `.env` file

### Database errors
Delete `multiwin.db` and restart the server to recreate the database

### Session issues
Make sure `SESSION_SECRET` is set in your environment variables

## Future Enhancements

Potential features for future development:
- [ ] Social sharing of layouts
- [ ] Public/private layout visibility
- [ ] Layout categories and tags
- [ ] Import/export layouts as JSON
- [ ] Collaborative layouts (multi-user editing)
- [ ] Video playlists support
- [ ] Custom themes
- [ ] Mobile app version

## Support

If you encounter any issues or have questions, please open an issue on GitHub.
