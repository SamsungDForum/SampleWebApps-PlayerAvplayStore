App = window.App || {};
App.VideoPlayerStore = (function VideoPlayerStore() {
    var playerStates = {
        IDLE: 'IDLE',
        NONE: 'NONE',
        PLAYING: 'PLAYING',
        PAUSED: 'PAUSED',
        READY: 'READY'
    };
    var JUMP_MILISECONDS = 3000;
    var FULLSCREEN_CLASS = 'fullscreenMode';

    /**
     * Creates a new player instance
     *
     * @param {Object} config - contains player configuration
     * @param {Element} config.playerEl - element of type <object> that player will play in
     * @param {String} config.url - video url
     * @param {Element} config.controls - element containing controls for the player
     * @param {Object} [config.logger] - custom logger object
     * @param {Boolean} [config.set4KMode] - flag defining whether 4K mode should be set
     *
     * @returns {Object} - player instance
     */
    function create(config, onCreated) {
        var logger = config.logger || console;
        var playerEl = config.playerEl;
        var timerEl = config.timerEl;

        var timeStamps = config.timeStamps;
        var currentTimeStamp = !!config.timeStamps && config.timeStamps.length > 0 ? 0 : -1;
        var isFullscreen = false;
        var playerCoords = {
            x: playerEl.offsetLeft,
            y: playerEl.offsetTop,
            width: playerEl.offsetWidth,
            height: playerEl.offsetHeight

        };
        var resolutionWidth;
        var resolutionHeight;
        var player;
        var videoDuration = 0;
        var listeners = {
            onbufferingstart: function onbufferingstart() {
                logger.log('Buffering start.');
            },
            onbufferingprogress: function onbufferingprogress(percent) {
                logger.log('Buffering progress data : ' + percent);
            },
            onbufferingcomplete: function onbufferingcomplete() {
                logger.log('Buffering complete.');
                videoDuration = videoDuration || player.getDuration();
            },
            oncurrentplaytime: function oncurrentplaytime(currentTime) {
                var message;
                var event = document.createEvent('Event');
                logger.log('Current playtime: ' + currentTime);

                if (currentTimeStamp >= 0 && timeStamps[currentTimeStamp].time <= currentTime) {
                    message = timeStamps[currentTimeStamp].message;
                    currentTimeStamp = currentTimeStamp < timeStamps.length - 1 ? currentTimeStamp += 1 : -1;

                    event.initEvent(message, false, true);
                    document.dispatchEvent(event);
                }
                if (timerEl) {
                    updateTime(
                        currentTime,
                        videoDuration
                    );
                }
            },
            onevent: function onevent(eventType, eventData) {
                logger.log('event type: ' + eventType + ', data: ' + eventData);
            },
            onstreamcompleted: function onstreamcompleted() {
                var event = document.createEvent('Event');

                logger.log('Stream Completed');
                if (timerEl) {
                    timerEl.textContent = '';
                }
                stop(true);

                event.initEvent('ENDED', true, true);
                document.dispatchEvent(event);
            },
            onerror: function onerror(eventType) {
                logger.error('event type error : ' + eventType);
            }
        };

        logger.log('Open: ' + config.url);

        document.addEventListener('visibilitychange', function eventHandler() {
            if (document.hidden) {
                suspendPlayer();
            } else {
                restorePlayer();
            }
        });

        // Check the screen width so that the AVPlay can be scaled accordingly
        tizen.systeminfo.getPropertyValue(
            'DISPLAY',
            function successHandler(data) {
                resolutionWidth = data.resolutionWidth;
                resolutionHeight = data.resolutionHeight;
                updatePlayerCoords(resolutionHeight, resolutionWidth);
                initialize(config.url);
            },
            function errorHandler() {
                resolutionWidth = window.innerWidth;
                resolutionHeight = window.innerHeight;
                initialize(config.url);
            }
        );

        function prepareAndPlay() {
            logger.log('Prepare');
            player.prepareAsync(play, logger.error);
        }

        function prepare() {
            try {
                player.prepareAsync(
                    function () {
                        logger.log('Prepared ' + player.player_id);
                    },
                    logger.error
                );
            } catch (e) {
                logger.error(e);
            }
        }

        function play() {
            try {
                switch (player.getState()) {
                    case playerStates.IDLE:
                        prepareAndPlay();
                        break;
                    case playerStates.READY: // Fallthrough
                    case playerStates.PAUSED:
                        player.play();
                        logger.log('Play');
                        break;
                    default:
                        logger.warn('Unhandled player state');
                        break;
                }
            } catch (error) {
                logger.error(error.message);
            }
        }

        /**
         * Needed for 'PlayPause' key
         */
        function playPause() {
            if (player.getState() === playerStates.PLAYING) {
                pause();
            } else {
                play();
            }
        }

        function stop(shouldFullScreenStay) {
            var playerState = player.getState();

            if (playerState === playerStates.PLAYING || playerState === playerStates.PAUSED) {
                player.stop();
                logger.log('Video stopped');

                updateTime(player.getCurrentTime(), videoDuration);

                if (isFullscreen && !shouldFullScreenStay) {
                    toggleFullscreen();
                }
            }
        }

        function pause() {
            var playerState = player.getState();

            if (playerState === playerStates.PLAYING || playerState === playerStates.READY) {
                player.pause();
                logger.log('Video paused');
            }
        }

        function ff() {
            try {
                player.jumpForward(JUMP_MILISECONDS);
                updateTime();
            } catch (error) {
                logger.error('Failed fast forwarding: ' + error.message);
            }
        }

        function rew() {
            try {
                player.jumpBackward(JUMP_MILISECONDS);
                updateTime();
            } catch (error) {
                logger.error('Failed rewinding: ' + error.message);
            }
        }

        function is4KSupported() {
            return webapis.productinfo.isUdPanelSupported();
        }

        /**
         * Set to TV to play UHD content.
         */
        function set4K() {
            player.setStreamingProperty('SET_MODE_4K', 'true');
            logger.log('4K mode is active');
        }

        /**
         * Function to set specific bitrates used to play the stream.
         * In case of Smooth Streaming STARTBITRATE and SKIPBITRATE values 'LOWEST', 'HIGHEST', 'AVERAGE' can be set.
         * For other streaming engines there must be numeric values.
         *
         * @param {Number} from  - Lower value of bitrates range.
         * @param {Number} to    - Higher value of the bitrates range.
         * @param {Number} start - Bitrate which should be used for initial chunks.
         * @param {Number} skip  - Bitrate that will not be used.
         */
        function setBitrate(from, to, start, skip) {
            var bitrates = '|BITRATES=' + from + '~' + to;

            if (start !== '' && start !== undefined) {
                bitrates += '|STARTBITRATE=' + start;
            }

            if (to !== '' && to !== undefined) {
                bitrates += '|SKIPBITRATE=' + skip;
            }

            try {
                player.setStreamingProperty('ADAPTIVE_INFO', bitrates);
            } catch (error) {
                logger.error('Failed setting bitrates: ' + error.message);
            }
        }

        /**
         * Function to change current VIDEO/AUDIO/TEXT track
         *
         * @param {String} type  - Streaming type received with player.getTotalTrackInfo(),
         *                          possible values are: VIDEO, AUDIO, TEXT.
         * @param {Number} index - Track id received with player.getTotalTrackInfo().
         */
        function setTrack(type, index) {
            try {
                player.setSelectTrack(type, index);
            } catch (error) {
                logger.error('Failed setting track: ' + error.message);
            }
        }

        /**
         * @returns {Object} - information about all available stream tracks
         */
        function getTracks() {
            var tracksObject = {};
            var trackInfo;

            try {
                trackInfo = player.getTotalTrackInfo();
                tracksObject = {
                    type: typeof trackInfo,
                    length: trackInfo.length,
                    tracks: trackInfo.map(function mapTrack(track) {
                        return {
                            index: track.index,
                            type: track.type,
                            extraInfo: track.extra_info
                        };
                    })
                };
            } catch (error) {
                logger.error('Failed getting tracks: ' + error.message);
            }

            return tracksObject;
        }

        /**
         * @returns {Object} - streaming properties
         */
        function getProperties() {
            var properties = {};

            try {
                properties = {
                    availableBitrate: player.getStreamingProperty('AVAILABLE_BITRATE'),
                    currentBandwidth: player.getStreamingProperty('CURRENT_BANDWITH'),
                    duration: player.getStreamingProperty('DURATION'),
                    bufferSize: player.getStreamingProperty('BUFFER_SIZE'),
                    startFragment: player.getStreamingProperty('START_FRAGMENT'),
                    cookie: player.getStreamingProperty('COOKIE'),
                    customMessage: player.getStreamingProperty('CUSTOM_MESSAGE')
                };
            } catch (error) {
                logger.error('Failed getting properties: ' + error.message);
            }

            return properties;
        }

        /**
         * Switch between full screen mode and normal windowed mode.
         */
        function toggleFullscreen() {
            if (!isFullscreen) {
                try {
                    player.setDisplayRect(0, 0, window.innerWidth, window.innerHeight);
                } catch (error) {
                    logger.log(error.message);
                }

                playerEl.classList.add(FULLSCREEN_CLASS);
                if (timerEl) {
                    timerEl.classList.add(FULLSCREEN_CLASS);
                }
                config.controls.classList.add(FULLSCREEN_CLASS);
                isFullscreen = true;
            } else {
                try {
                    player.setDisplayRect(
                        playerCoords.x,
                        playerCoords.y,
                        playerCoords.width,
                        playerCoords.height
                    );
                } catch (error) {
                    logger.log(error.message);
                }

                playerEl.classList.remove(FULLSCREEN_CLASS);
                config.controls.classList.remove(FULLSCREEN_CLASS);
                if (timerEl) {
                    timerEl.classList.remove(FULLSCREEN_CLASS);
                }
                isFullscreen = false;
            }
        }

        function initialize(url) {
            try {
                player = webapis.avplaystore.getPlayer();
                player.open(url);
                player.setDisplayRect(
                    playerCoords.x,
                    playerCoords.y,
                    playerCoords.width,
                    playerCoords.height
                );
                player.setListener(listeners);
                player.setDisplayMethod('PLAYER_DISPLAY_MODE_AUTO_ASPECT_RATIO');

                if (config.set4KMode) {
                    if (is4KSupported()) {
                        set4K();
                    } else {
                        logger.log('4K is not supported');
                    }
                }
                if (onCreated) {
                    onCreated();
                }
            } catch (error) {
                logger.error(error.message);
            }
        }

        function updateTime(currentTime, duration) {
            if (timerEl) {
                timerEl.textContent = App.Utils.msToReadableTime(currentTime)
                    + ' / '
                    + App.Utils.msToReadableTime(duration);
            }
        }

        function suspendPlayer() {
            var playerState = player.getState();
            if (playerState === playerStates.READY
                || playerState === playerStates.PLAYING
                || playerState === playerStates.PAUSED) {
                player.suspend();
            }
        }

        function restorePlayer() {
            var playerState = player.getState();
            if (playerState === playerStates.NONE
                || playerState === playerStates.PLAYING
                || playerState === playerStates.PAUSED) {
                player.restore();
            }
        }

        function updatePlayerCoords(screenHeight, screenWidth) {
            var viewPortHeight = 1080;
            var viewPortWidth = 1920;
            playerCoords.x *= screenWidth / viewPortWidth;
            playerCoords.y *= screenHeight / viewPortHeight;
            playerCoords.width *= screenWidth / viewPortWidth;
            playerCoords.height *= screenHeight / viewPortHeight;
        }

        return {
            player: player,
            play: play,
            playPause: playPause,
            stop: stop,
            pause: pause,
            ff: ff,
            rew: rew,
            setBitrate: setBitrate,
            setTrack: setTrack,
            getTracks: getTracks,
            getProperties: getProperties,
            toggleFullscreen: toggleFullscreen,
            suspendPlayer: suspendPlayer,
            restorePlayer: restorePlayer,
            prepare: prepare
        };
    }

    return {
        create: create,
        playerStates: playerStates
    };
}());
