#!/usr/bin/env python3
"""
Setup script for @yamf/core Python client
"""

from setuptools import setup, find_packages

with open("README.md", "r", encoding="utf-8") as fh:
    long_description = fh.read()

setup(
    name="yamf",
    version="1.0.0",
    author="@yamf/core Team",
    description="Python client library for the nodejs @yamf microservices framework",
    long_description=long_description,
    long_description_content_type="text/markdown",
    url="https://github.com/mcbrumagin/yamf/core/api/languages/python",
    packages=['yamf'],
    python_requires=">=3.7",
    install_requires=[
        "requests>=2.28.0",
    ],
    keywords="microservices, service-discovery, pubsub, http, framework",
)

