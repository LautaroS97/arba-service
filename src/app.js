const express = require('express');
const bodyParser = require('body-parser');
const puppeteer = require('puppeteer');
const nodemailer = require('nodemailer');
const helmet = require('helmet');
const morgan = require('morgan');
const cors = require('cors');

const app = express();
const port = process.env.PORT || 80;

app.use(helmet());
app.use(bodyParser.json());
app.use(morgan('combined'));

// Configurar CORS para permitir solicitudes desde tu dominio
app.use(cors({
    origin: 'https://proprop.com.ar', // Reemplaza con tu dominio
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    credentials: true,
    optionsSuccessStatus: 204
}));

app.options('*', cors());

app.post('/fetch-arba-data', async (req, res) => {
    console.log('Received data:', req.body);
    const { lat, lng, email } = req.body;
    try {
        const { partida, partido } = await fetchArbaData(lat, lng);
        if (partida && partido) {
            await sendEmail(email, partida, partido);
            console.log('Email sent with data:', { partida, partido });
            res.send({ message: 'Email enviado con éxito', partida: partida, partido: partido });
        } else {
            console.error('No se pudo obtener la partida o el partido');
            res.status(500).send({ error: 'No se pudo obtener la partida o el partido' });
        }
    } catch (error) {
        console.error('Error en el proceso:', error);
        res.status(500).send({ error: 'Error procesando la solicitud' });
    }
});

async function fetchArbaData(lat, lng) {
    let browser;
    try {
        console.log('Launching Puppeteer...');
        browser = await puppeteer.launch({
            args: ['--no-sandbox', '--disable-setuid-sandbox'],
        });
        const page = await browser.newPage();

        console.log('Navegando a la página de ARBA...');
        await page.goto('https://carto.arba.gov.ar/cartoArba/', { waitUntil: 'networkidle2' });

        await page.waitForTimeout(1000);

        console.log('Modificando manejadores de eventos...');
        await page.evaluate(() => {
            document.querySelectorAll('*').forEach(el => {
                el.onclick = null;
                el.onmousedown = null;
            });
        });

        console.log('Esperando al botón de información...');
        await page.waitForSelector('.olControlInfoButtonItemInactive.olButton[title="Información"]', { visible: true });
        await page.evaluate(() => {
            const button = document.querySelector('.olControlInfoButtonItemInactive.olButton[title="Información"]');
            if (button) {
                button.style.pointerEvents = 'auto';
                ['mousedown', 'mouseup', 'click'].forEach(event => {
                    button.dispatchEvent(new MouseEvent(event, {
                        bubbles: true,
                        cancelable: true,
                        view: window
                    }));
                });
            }
        });

        console.log(`Introduciendo coordenadas: ${lat}, ${lng}`);
        await page.type('#inputfindall', `${lat},${lng}`);

        console.log('Haciendo clic en la lista de sugerencias...');
        await page.waitForSelector('#ui-id-1', { visible: true, timeout: 30000 });
        await page.click('#ui-id-1');

        await page.waitForTimeout(5000);

        console.log('Haciendo clic en el centro de la pantalla...');
        const dimensions = await page.evaluate(() => {
            return {
                width: document.documentElement.clientWidth,
                height: document.documentElement.clientHeight
            };
        });

        const centerX = dimensions.width / 2;
        const centerY = dimensions.height / 2;
        await page.mouse.click(centerX, centerY);

        await page.waitForTimeout(10000);

        console.log('Esperando a que aparezca el contenedor de información...');
        await page.waitForSelector('.panel.curva.panel-info .panel-body div', { visible: true });

        console.log('Obteniendo datos de la partida...');
        const partida = await page.evaluate(() => {
            const table = document.querySelector('.panel.curva.panel-info .table.table-condensed_left');
            if (table) {
                const cell = table.querySelector('tbody tr td');
                if (cell) {
                    return cell.textContent.trim();
                }
            }
            throw new Error('No se pudo encontrar el dato de partida');
        });

        console.log(`Número de partida obtenido: ${partida}`);

        console.log('Obteniendo datos del partido...');
        const partido = await page.evaluate(() => {
            const div = document.querySelector('.panel.curva.panel-info .panel-body div:first-of-type');
            return div ? div.textContent.trim() : 'No encontrado';
        });

        console.log(`Datos del partido obtenidos: ${partido}`);

        console.log('Cerrando el navegador...');
        await browser.close();
        return { partida, partido };
    } catch (error) {
        console.error('Error en Puppeteer:', error);
        if (browser) await browser.close();
        throw error;
    }
}

async function sendEmail(email, partida, partido) {
    let transporter = nodemailer.createTransport({
        host: "smtp-relay.brevo.com",
        port: 465,
        secure: true,
        auth: {
            user: "eabu72@gmail.com",
            pass: "9VtU5jOsXpNK6hm1"
        },
        tls: {
            rejectUnauthorized: false
        },
        connectionTimeout: 5000,
        greetingTimeout: 5000,
        socketTimeout: 10000,
    });

    let mailOptions = {
        from: '"PROPROP" <info@proprop.com.ar>',
        to: email,
        subject: "Consulta de ARBA",
        text: `El número de partida inmobiliaria de ARBA es: ${partida}\nLa ubicación es: ${partido}`,
        html: `El número de partida inmobiliaria de ARBA es:<br><b>${partida}</b><hr>La ubicación es: <br><b>${partido}</b>`
    };

    try {
        let info = await transporter.sendMail(mailOptions);
        console.log('Message sent: %s', info.messageId);
    } catch (error) {
        console.error('Error enviando email:', error);
        throw error;
    }
}

const server = app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});

server.setTimeout(10000);