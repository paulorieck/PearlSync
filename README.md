# PearlSync

ESTE É UM SISTEMA AINDA EM DESENVOLVIMENTO! FAÇA O DOWNLOAD APENAS CASO TENHA CONHECIMENTO TÉCNICO E TENHA A INTEÇÃO DE AJUDAR! ERROS ACONTECERÃO!

Aplicativo de sincronização de pastas entre diferentes computadores (um par ou mais), mesmo que estes estejam em diferentes redes.

Não há um servidor de arquivos central. O compartilhamento é feito em um modelo P2P.

Um mínimo de dados é encaminhado para um servidor central apenas com o objetivo de estabelecer as conexões através de punch hole. Nenhum dado sensível é armazenado, a não ser durante uma seção, no servidor, como IPs, portas, estruturas de pastas, etc.

SEJA BEM VINDO! SE VOCÊ TEM ALGUM CONHECIMENTO EM HTML, CSS, JAVASCRIT, NODE JS, OU EM ELECTRON, AJUDE NO DESENVOLVIMENTO DESTE SOFTWARE!

Instruções de uso:
1 - Faça o download do pacote;
2 - Instale um servidor acessível por IP público;
 2.1 - Transfira o conteúdo de PearlSync_Server para este servidor;
 2.2 - Execute de dentro desta pasta o comando "npm install" para que as dependências corretas sejam instaladas para o seu sistema operacional;
 2.3 - Execute o arquivo pearl_sync_server.js (node pearl_sync_server.js, ou, pm2 pearl_sync_server.js)
 2.4 - O sistema por enquanto escuta na porta 9999;
3 - Instale um cliente;
 3.1 - Faça a transferência de PearSync_Client para a pasta desejada;
 3.2 - Execute de dentro desta pasta o comando "npm install" para que as dependências corretas sejam instaladas para o seu sistema operacional;
 3.3 - Crie um arquivo de configuração de nome "config.json" conforme modelo apresentado abaixo dentro da pasta PearSync_Client;
 OU 3.3 - Execute o comando conforme a seguir para a primeira configuração: "./node_modules/.bin/electron main.js server_ip=XX.XX.XX.XX server_port=9999 factory_reset=true"
 3.4 - Para as próximas execuções basta executar "npm start"
 
MODELO DE CONTEÚDO DO ARQUIVO config.json
{"server_ip":"XX.XX.XX.XX","server_default_port":9999}

Licença MIT
-----------

Copyright (c) 2019 Paulo André Rieck

 Permission is hereby granted, free of charge, to any person obtaining a copy
 of this software and associated documentation files (the "Software"), to deal
 in the Software without restriction, including without limitation the rights
 to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 copies of the Software, and to permit persons to whom the Software is
 furnished to do so, subject to the following conditions:

 The above copyright notice and this permission notice shall be included in
 all copies or substantial portions of the Software.

 THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 THE SOFTWARE.
