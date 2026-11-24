"""
Chaturbate plugin for Streamlink (sideloaded).
Ported to the modern Streamlink plugin API (6.x+) from:
https://gist.github.com/mywalkb/1c9a26a59018cf1af40eb2fe0e8dea33
"""

import logging
import re
import uuid

from streamlink.plugin import Plugin, pluginmatcher
from streamlink.plugin.api import validate
from streamlink.stream.hls import HLSStream

log = logging.getLogger(__name__)

API_HLS = "https://chaturbate.com/get_edge_hls_url_ajax/"


@pluginmatcher(re.compile(r"https?://(?:\w+\.)?chaturbate\.com/(?P<username>\w+)"))
class Chaturbate(Plugin):
    def _get_streams(self):
        username = self.match.group("username")
        csrf_token = uuid.uuid4().hex.upper()[:32]

        data = self.session.http.post(
            API_HLS,
            headers={
                "Content-Type": "application/x-www-form-urlencoded",
                "X-CSRFToken": csrf_token,
                "X-Requested-With": "XMLHttpRequest",
                "Referer": self.url,
            },
            cookies={"csrftoken": csrf_token},
            data={"room_slug": username, "bandwidth": "high"},
            schema=validate.Schema(
                validate.parse_json(),
                {
                    "url": str,
                    "room_status": str,
                    "success": validate.any(bool, int),
                },
            ),
        )

        log.info(f"Stream status: {data['room_status']}")
        log.debug(f"Playlist URL: {data['url']}")

        if data["success"] and data["room_status"] == "public" and data["url"]:
            self.author = username
            return HLSStream.parse_variant_playlist(self.session, data["url"])


__plugin__ = Chaturbate
