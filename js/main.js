App = window.App || {};
App.Main = (function Main() {
    var players = {};
    var currentPlayer;
    var logger;
    var commercialLabelEl = document.querySelector('.commercial');
    var timestamps = [
        {
            time: 300000,
            message: 'Commercial'
        },
        {
            time: 600000,
            message: 'Commercial'
        }
    ];

    function addButtonsHandlers() {
        var buttonsWithHandlers = [
            { elementSelector: '.play', handler: playHandler },
            { elementSelector: '.pause', handler: pauseHandler },
            { elementSelector: '.stop', handler: stopHandler },
            { elementSelector: '.ff', handler: ffHandler },
            { elementSelector: '.rew', handler: rewHandler },
            { elementSelector: '.fullscreen', handler: fullscreenHandler }
        ];

        App.KeyHandler.addHandlersForButtons(buttonsWithHandlers);
    }

    function playHandler() {
        currentPlayer.play();
    }

    function pauseHandler() {
        currentPlayer.pause();
    }

    function stopHandler() {
        players.basic.stop();
        players.commercials.stop();
    }

    function ffHandler() {
        if (currentPlayer === players.basic) {
            currentPlayer.ff();
        } else {
            logger.warn('This method is not available on this player');
        }
    }

    function rewHandler() {
        if (currentPlayer === players.basic) {
            currentPlayer.rew();
        } else {
            logger.warn('This method is not available on this player');
        }
    }

    function fullscreenHandler() {
        players.basic.toggleFullscreen();
        players.commercials.toggleFullscreen();
    }

    function switchPlayerTo(newPlayer) {
        currentPlayer.suspendPlayer();
        currentPlayer = newPlayer;
        newPlayer.restorePlayer();
        newPlayer.play();
    }

    function toggleCommercialLabel() {
        commercialLabelEl.classList.toggle('hidden');
    }

    window.onload = function onload() {
        var configBasic;
        var configCommercials;
        var playerEl = document.querySelector('#av-player');
        var controlsEl = document.querySelector('.buttons');
        var timerEl = document.querySelector('.time');
        var loggerContainer = document.querySelector('.logsContainer');
        var playerLogger = App.Logger.create({
            loggerEl: document.querySelector('.logsContainer'),
            loggerName: 'Player',
            logLevel: App.Logger.logLevels.ALL
        });

        logger = App.Logger.create({
            loggerEl: loggerContainer,
            loggerName: 'Main',
            logLevel: App.Logger.logLevels.ALL
        });

        configBasic = {
            url: 'https://storage.googleapis.com/shaka-demo-assets/sintel-trickplay/dash.mpd',
            playerEl: playerEl,
            controls: controlsEl,
            timerEl: timerEl,
            logger: playerLogger,
            timeStamps: timestamps
        };

        configCommercials = {
            url: 'http://developer.samsung.com/onlinedocs/tv/Preview/1.mp4',
            playerEl: playerEl,
            controls: controlsEl,
            timerEl: timerEl,
            logger: playerLogger
        };

        players.basic = App.VideoPlayerStore.create(configBasic);
        players.commercials = App.VideoPlayerStore.create(configCommercials, function onCreated() {
            currentPlayer = players.commercials;
            currentPlayer.prepare();
        });
        logger.log('playersCreated');

        addButtonsHandlers();

        document.addEventListener('Commercial', function CommercialBreak() {
            switchPlayerTo(players.commercials);
            toggleCommercialLabel();
        });

        document.addEventListener('ENDED', function CommercialBreak() {
            if (currentPlayer === players.commercials) {
                toggleCommercialLabel();
                switchPlayerTo(players.basic);
            }
        });
    };
}());
